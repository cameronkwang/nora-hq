import "server-only";
import { and, asc, desc, eq, gte, inArray, isNotNull, like, lt, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "./db";
import { newId } from "./ids";
import { addMonths, currentMonth, isMonth, monthLabel, today } from "./dates";
import { monthBounds } from "./integrations/time";
import { logActivity } from "./activity";
import { getClientMonth } from "./reports";
import { OpsError, createDraft, markDraftSent, reviseDraft } from "./ops";
import { markdownToPlainText } from "@/components/report-markdown";
import type { ClientReport, Draft } from "./schema";

/**
 * Monthly client reports. Two per business per month:
 *  - "internal": for Cameron & Nora only — candid: plan misses, revision rate, blockers, pipeline.
 *  - "external": owner-facing — wins, numbers with context. Goes through the review queue (drafts kind "report",
 *    meta { reportId, audience: "external", month }); approving it marks the report approved but NEVER sends it.
 *    Only a person sends it (sendClientReport) to the business's owner email.
 * Claude may build metrics and create/revise reports (status draft). It can't approve, send or mark sent.
 * Owners only ever receive what a person sends: there is no automatic sending anywhere.
 */

const Actor = z.string().trim().min(1).max(200);
const Month = z.string().refine(isMonth, "Use YYYY-MM");
const Audience = z.enum(["internal", "external"]);
export type ReportAudience = z.infer<typeof Audience>;
const isPerson = (a: string) => a !== "claude" && a !== "system" && a !== "public";

const pctChange = (cur: number | null | undefined, prev: number | null | undefined) =>
  cur == null || prev == null || prev === 0 ? null : Math.round(((cur - prev) / prev) * 1000) / 10;
const hoursBetween = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 3_600_000;

async function getBusiness(clientId: string) {
  const db = await getDb();
  const [c] = await db.select().from(schema.clients).where(eq(schema.clients.id, clientId));
  if (!c) throw new OpsError(`No business with id "${clientId}"`);
  if (c.kind === "creator") throw new OpsError("Reports are for managed businesses, not Nora's own workspace.");
  return c;
}

/* ───────────────────────── Metrics ───────────────────────── */

export type ExternalMetrics = Awaited<ReturnType<typeof buildReportMetrics>>["external"];
export type InternalMetrics = Awaited<ReturnType<typeof buildReportMetrics>>["internal"];

/**
 * The numbers a month's reports are based on, split by audience. `external` is safe to show an owner;
 * `internal` is team-only (effort, misses, blockers) and must never appear in the external report.
 */
export async function buildReportMetrics(clientId: string, month: string) {
  Month.parse(month);
  const client = await getBusiness(clientId);
  const cm = await getClientMonth(clientId, month);
  if (!cm) throw new OpsError(`No business with id "${clientId}"`);
  const db = await getDb();
  const { start, end } = monthBounds(month);
  const now = new Date();
  const todayStr = today();

  const [published, reviewsInMonth, allRatings, topMedia, activityCounts, reviewedDrafts, openAsks, failedDrafts, badConnections] = await Promise.all([
    db.select({ platform: schema.contentPosts.platform, format: schema.contentPosts.format, permalink: schema.contentPosts.permalink, publishedAt: schema.contentPosts.publishedAt })
      .from(schema.contentPosts)
      .where(and(eq(schema.contentPosts.clientId, clientId), eq(schema.contentPosts.status, "published"),
        sql`coalesce(${schema.contentPosts.publishedAt}, ${schema.contentPosts.scheduledFor}) >= ${start.toISOString()}`,
        sql`coalesce(${schema.contentPosts.publishedAt}, ${schema.contentPosts.scheduledFor}) < ${end.toISOString()}`)),
    db.select({ rating: schema.reviews.rating, replied: sql<boolean>`${schema.reviews.replyText} is not null` }).from(schema.reviews)
      .where(and(eq(schema.reviews.clientId, clientId), gte(schema.reviews.createTime, start), lt(schema.reviews.createTime, end))),
    db.select({ avg: sql<number | null>`avg(${schema.reviews.rating})::float`, n: sql<number>`count(${schema.reviews.rating})::int` }).from(schema.reviews)
      .where(and(eq(schema.reviews.clientId, clientId), isNotNull(schema.reviews.rating), lt(schema.reviews.createTime, end))),
    // Nora's own posts tagged as a collab for this business (the only per-post numbers we have).
    db.select().from(schema.creatorMedia)
      .where(and(eq(schema.creatorMedia.clientId, clientId), gte(schema.creatorMedia.postedAt, start), lt(schema.creatorMedia.postedAt, end)))
      .orderBy(sql`${schema.creatorMedia.views} desc nulls last`).limit(3),
    // Approvals / send-backs from the audit log, so a draft sent back then approved counts both ways.
    db.select({ action: schema.activity.action, n: sql<number>`count(*)::int` }).from(schema.activity)
      .where(and(eq(schema.activity.clientId, clientId), inArray(schema.activity.action, ["draft.approved", "draft.rejected"]), gte(schema.activity.createdAt, start), lt(schema.activity.createdAt, end)))
      .groupBy(schema.activity.action),
    db.select({ createdAt: schema.drafts.createdAt, reviewedAt: schema.drafts.reviewedAt, kind: schema.drafts.kind }).from(schema.drafts)
      .where(and(eq(schema.drafts.clientId, clientId), inArray(schema.drafts.status, ["approved", "sent", "failed"]), gte(schema.drafts.reviewedAt, start), lt(schema.drafts.reviewedAt, end))),
    db.select({ id: schema.asks.id, body: schema.asks.body, status: schema.asks.status, createdAt: schema.asks.createdAt }).from(schema.asks)
      .where(and(eq(schema.asks.clientId, clientId), inArray(schema.asks.status, ["new", "in_progress"]))).orderBy(asc(schema.asks.createdAt)).limit(20),
    db.select({ title: schema.drafts.title, error: schema.drafts.error }).from(schema.drafts).where(and(eq(schema.drafts.clientId, clientId), eq(schema.drafts.status, "failed"))).limit(10),
    db.select({ provider: schema.connections.provider, status: schema.connections.status, lastError: schema.connections.lastError }).from(schema.connections)
      .where(and(eq(schema.connections.clientId, clientId), ne(schema.connections.status, "ok"))),
  ]);

  /* External */
  const postsByPlatform: Record<string, number> = {};
  for (const p of published) postsByPlatform[p.platform] = (postsByPlatform[p.platform] ?? 0) + 1;
  const cur = cm.metrics[cm.metrics.length - 1];
  const prev = cm.metrics[cm.metrics.length - 2];
  const platformNumbers = (["instagram", "tiktok", "google"] as const).map((p) => {
    const c = cur?.[p];
    const pr = prev?.[p];
    if (!c && !pr) return null;
    return {
      platform: p,
      views: c?.views ?? null, reach: c?.reach ?? null, followers: c?.followers ?? null, engagements: c?.engagements ?? null,
      previous: pr ? { views: pr.views, reach: pr.reach, followers: pr.followers, engagements: pr.engagements } : null,
      changePct: { views: pctChange(c?.views, pr?.views), reach: pctChange(c?.reach, pr?.reach), followers: pctChange(c?.followers, pr?.followers), engagements: pctChange(c?.engagements, pr?.engagements) },
      followerGain: c?.followers != null && pr?.followers != null ? c.followers - pr.followers : null,
    };
  }).filter((x): x is NonNullable<typeof x> => !!x);

  const rated = reviewsInMonth.filter((r) => r.rating != null);
  const postedCollabs = cm.outreach.filter((o) => o.stage === "posted" && o.lastActivityAt && o.lastActivityAt >= start && o.lastActivityAt < end);

  const external = {
    business: client.name,
    month,
    monthLabel: monthLabel(month),
    postsPublished: { total: published.length, byPlatform: postsByPlatform },
    platforms: platformNumbers,
    metricsNote: platformNumbers.length ? "Monthly numbers as recorded in Nora HQ (Business page → Numbers). changePct is vs the previous month." : "No monthly numbers recorded for this month yet.",
    topPosts: topMedia.map((m) => ({ platform: m.platform, caption: m.caption?.slice(0, 140) ?? null, permalink: m.permalink, views: m.views, likes: m.likes, comments: m.comments, shares: m.shares, saves: m.saves })),
    googleReviews: {
      received: reviewsInMonth.length,
      replied: reviewsInMonth.filter((r) => r.replied).length,
      averageRatingThisMonth: rated.length ? Math.round((rated.reduce((a, r) => a + (r.rating ?? 0), 0) / rated.length) * 10) / 10 : null,
      averageRatingOverall: allRatings[0]?.avg != null ? Math.round(allRatings[0].avg * 10) / 10 : null,
      ratedReviewsOverall: allRatings[0]?.n ?? 0,
    },
    creatorCollabsCompleted: {
      count: postedCollabs.length,
      creators: postedCollabs.map((o) => ({ name: o.creator.name, handle: o.creator.instagramHandle ? `@${o.creator.instagramHandle}` : o.creator.tiktokHandle ? `@${o.creator.tiktokHandle}` : null, postUrl: o.postUrl })),
    },
    nextMonthFocus: `Placeholder — write 1–3 focus points for ${monthLabel(addMonths(month, 1))} (what we'll do next, in plain words).`,
  };

  /* Internal */
  const plan = cm.plan.map((p) => ({
    deliverable: p.deliverable.title, platform: p.deliverable.platform, target: p.target, planned: p.planned, done: p.done,
    completionPct: p.target > 0 ? Math.round((p.done / p.target) * 100) : p.planned > 0 ? Math.round((p.done / p.planned) * 100) : null,
  }));
  const adhoc = cm.monthTasks.filter((t) => !t.deliverableId);
  const overdue = cm.openTasks.filter((t) => t.dueDate && t.dueDate < todayStr);
  const counts = new Map(activityCounts.map((r) => [r.action, r.n]));
  const approved = counts.get("draft.approved") ?? 0;
  const sentBack = counts.get("draft.rejected") ?? 0;
  const approveHours = reviewedDrafts.filter((d) => d.reviewedAt).map((d) => hoursBetween(d.createdAt, d.reviewedAt!));
  const pipeline: Record<string, number> = {};
  for (const o of cm.outreach) pipeline[o.stage] = (pipeline[o.stage] ?? 0) + 1;
  const blocked = cm.openTasks.filter((t) => t.status === "blocked");
  const firstLine = (s: string) => (s.split("\n").find((l) => l.trim()) ?? "").trim().slice(0, 120);

  const internal = {
    planCompletion: plan,
    planOverallPct: (() => {
      const t = plan.filter((p) => p.target > 0);
      const target = t.reduce((a, p) => a + p.target, 0);
      return target ? Math.round((t.reduce((a, p) => a + Math.min(p.done, p.target), 0) / target) * 100) : null;
    })(),
    adHocTasks: { done: adhoc.filter((t) => t.status === "done").length, open: adhoc.filter((t) => t.status !== "done").length },
    overdueTasks: { count: overdue.length, items: overdue.slice(0, 10).map((t) => ({ title: t.title, dueDate: t.dueDate, assignee: t.assignee, month: t.month })) },
    drafts: {
      approved, sentBack,
      revisionRatePct: approved + sentBack > 0 ? Math.round((sentBack / (approved + sentBack)) * 100) : null,
      avgHoursToApprove: approveHours.length ? Math.round((approveHours.reduce((a, h) => a + h, 0) / approveHours.length) * 10) / 10 : null,
      waitingForReview: cm.pendingDrafts,
    },
    unrepliedReviews: cm.unrepliedReviews,
    outreachPipeline: pipeline,
    openAsks: { count: openAsks.length, items: openAsks.slice(0, 8).map((a) => ({ status: a.status, ask: firstLine(a.body), since: a.createdAt.toISOString().slice(0, 10) })) },
    issues: [
      ...blocked.map((t) => `Blocked task: ${t.title}`),
      ...failedDrafts.map((d) => `Send failed: ${d.title}${d.error ? ` — ${d.error}` : ""}`),
      ...badConnections.map((c) => `${c.provider} connection ${c.status}${c.lastError ? `: ${c.lastError}` : ""}`),
      ...(cm.unrepliedReviews > 0 ? [`${cm.unrepliedReviews} Google review${cm.unrepliedReviews === 1 ? "" : "s"} without a reply`] : []),
      ...(platformNumbers.length === 0 ? ["No monthly numbers recorded for this month"] : []),
    ],
  };

  return { client: { id: client.id, name: client.name, location: client.location }, month, generatedAt: now.toISOString(), external, internal };
}

/* ───────────────────────── Create / revise (Claude allowed) ───────────────────────── */

export const ReportInput = z.object({
  clientId: z.string().min(1),
  month: Month,
  audience: Audience,
  body: z.string().trim().min(20, "The report is too short.").max(20_000),
});

/**
 * Creates (or revises, if not yet approved) the month's report for one audience. Status is always "draft".
 * External: also files/updates a "report" draft so it shows in Review for a person to approve.
 */
export async function createReport(input: z.input<typeof ReportInput>, actor: string) {
  const a = Actor.parse(actor);
  const v = ReportInput.parse(input);
  const client = await getBusiness(v.clientId);
  const metrics = await buildReportMetrics(v.clientId, v.month);
  const snapshot = v.audience === "external" ? { external: metrics.external } : { external: metrics.external, internal: metrics.internal };
  const label = monthLabel(v.month);
  const title = `${client.name} — ${label} report`;
  const db = await getDb();
  const r = schema.clientReports;
  const [cur] = await db.select().from(r).where(and(eq(r.clientId, v.clientId), eq(r.month, v.month), eq(r.audience, v.audience)));

  if (cur?.status === "sent") throw new OpsError(`The ${v.audience} ${label} report for ${client.name} was already sent — it can't be changed.`);
  if (cur?.status === "approved" && !isPerson(a))
    throw new OpsError(`The external ${label} report for ${client.name} is already approved. Ask Nora or Cameron in an ask if it needs changes.`);

  const id = cur?.id ?? newId("rpt_");
  if (cur) {
    await db.update(r).set({ body: v.body, metrics: snapshot, status: "draft", updatedAt: new Date() }).where(eq(r.id, cur.id));
  } else {
    await db.insert(r).values({ id, clientId: v.clientId, month: v.month, audience: v.audience, body: v.body, metrics: snapshot, status: "draft", createdBy: a });
  }

  let draftId = cur?.draftId ?? null;
  if (v.audience === "external") {
    const [d] = draftId ? await db.select().from(schema.drafts).where(eq(schema.drafts.id, draftId)) : [];
    if (d && (d.status === "needs_review" || d.status === "rejected")) {
      await reviseDraft(d.id, { body: v.body, title }, a); // Claude revising a sent-back draft resubmits it
      if (d.status === "rejected" && isPerson(a)) await db.update(schema.drafts).set({ status: "needs_review" }).where(eq(schema.drafts.id, d.id));
    } else {
      draftId = await createDraft({ clientId: v.clientId, kind: "report", title, body: v.body, meta: { reportId: id, audience: "external", month: v.month } }, a);
      await db.update(r).set({ draftId }).where(eq(r.id, id));
    }
  }

  await logActivity({
    actor: a, action: cur ? "report.revised" : "report.created", entityType: "client_report", entityId: id, clientId: v.clientId,
    summary: `${cur ? "Revised" : "Drafted"} the ${v.audience} ${label} report`,
  });
  return { id, status: "draft" as const, draftId, audience: v.audience };
}

/**
 * Called by ops.approveDraft for kind "report" (after the draft is claimed as approved by a person).
 * Marks the client report approved with the approved text. Does NOT send anything.
 */
export async function onReportDraftApproved(draft: Draft, actor: string): Promise<{ status: "approved"; message: string }> {
  if (!isPerson(actor)) throw new OpsError("Only a person can approve");
  const reportId = String(draft.meta.reportId ?? "");
  if (!reportId) return { status: "approved", message: "Approved." };
  const db = await getDb();
  const r = schema.clientReports;
  // Only the report this draft was created for: same id, its own draft, same business, external.
  const [row] = await db.update(r).set({ status: "approved", body: draft.body, updatedAt: new Date() })
    .where(and(eq(r.id, reportId), eq(r.draftId, draft.id), eq(r.clientId, draft.clientId ?? ""), eq(r.audience, "external"), ne(r.status, "sent")))
    .returning();
  if (!row) {
    // Put the draft back so it isn't left "approved" with no report behind it.
    await db.update(schema.drafts).set({ status: "needs_review", reviewedBy: null, reviewedAt: null, updatedAt: new Date() })
      .where(and(eq(schema.drafts.id, draft.id), eq(schema.drafts.status, "approved")));
    throw new OpsError("This draft isn't linked to that business's external report (or the report was already sent). Nothing was approved.");
  }
  await logActivity({ actor, action: "report.approved", entityType: "client_report", entityId: row.id, clientId: row.clientId, summary: `Approved the external ${monthLabel(row.month)} report` });
  return { status: "approved", message: "Approved — nothing was sent. Send it to the owner from the business's Reports page." };
}

/* ───────────────────────── Send (people only) ───────────────────────── */

/**
 * The external report a report draft belongs to — only when the report itself points back at that draft.
 * Use this instead of trusting draft.meta.reportId.
 */
export async function reportForDraft(draft: Draft): Promise<ClientReport> {
  const reportId = String(draft.meta.reportId ?? "");
  if (draft.kind !== "report" || !reportId) throw new OpsError("This draft isn't linked to a report.");
  const db = await getDb();
  const [rep] = await db.select().from(schema.clientReports).where(eq(schema.clientReports.id, reportId));
  if (!rep || rep.draftId !== draft.id || rep.clientId !== draft.clientId) throw new OpsError("This draft isn't linked to that report.");
  if (rep.audience !== "external") throw new OpsError("Internal reports are for the team only — they're never sent.");
  return rep;
}

/** The text that goes to the owner: the approved draft's current text (edits saved after approval included). */
async function syncApprovedBody(rep: ClientReport): Promise<ClientReport> {
  if (!rep.draftId) return rep;
  const db = await getDb();
  const [d] = await db.select().from(schema.drafts).where(eq(schema.drafts.id, rep.draftId));
  if (!d || d.status !== "approved" || d.body === rep.body) return rep;
  const [row] = await db.update(schema.clientReports).set({ body: d.body, updatedAt: new Date() })
    .where(and(eq(schema.clientReports.id, rep.id), eq(schema.clientReports.status, "approved"))).returning();
  return row ?? rep;
}

export type SendOutcome = { status: "sent" | "approved" | "failed"; message: string };

/**
 * Emails an approved external report to the business's owner (clients.ownerEmail) from the shared Gmail
 * inbox, as plain text. Without Gmail it returns a "copy it" message and changes nothing.
 */
export async function sendClientReport(reportId: string, actor: string): Promise<SendOutcome> {
  const a = Actor.parse(actor);
  if (!isPerson(a)) throw new OpsError("Only Nora or Cameron can send a report.");
  const db = await getDb();
  const r = schema.clientReports;
  const [found] = await db.select().from(r).where(eq(r.id, reportId));
  if (!found) throw new OpsError("That report doesn't exist anymore.");
  if (found.audience !== "external") throw new OpsError("Internal reports are for the team only — they're never sent.");
  const rep = found.status === "approved" ? await syncApprovedBody(found) : found;
  if (rep.status === "sent") throw new OpsError(`Already sent${rep.sentTo ? ` to ${rep.sentTo}` : ""}.`);
  if (rep.status !== "approved") throw new OpsError("Approve the report in Review first.");
  const client = await getBusiness(rep.clientId);
  const to = client.ownerEmail?.trim().toLowerCase();
  if (!to) throw new OpsError(`Add ${client.name}'s owner email in the business settings first.`);

  // Claim it so two clicks can't send twice; released again if sending doesn't happen.
  const [claimed] = await db.update(r).set({ status: "sent", sentAt: new Date(), sentTo: to, updatedAt: new Date() })
    .where(and(eq(r.id, rep.id), eq(r.status, "approved"))).returning();
  if (!claimed) throw new OpsError("Someone already sent this report.");
  const release = () => db.update(r).set({ status: "approved", sentAt: null, sentTo: null }).where(eq(r.id, rep.id));

  const subject = `${client.name} — ${monthLabel(rep.month)} report`;
  let res: Awaited<ReturnType<typeof sendPlainEmail>>;
  try {
    res = await sendPlainEmail({ to, subject, body: markdownToPlainText(rep.body) });
  } catch (e) {
    await release();
    throw e;
  }
  if (!res.ok) {
    await release();
    if (res.notConfigured) return { status: "approved", message: `Gmail isn't connected. Copy it and send from your email to ${to}, then press “Mark sent”.` };
    await logActivity({ actor: "system", action: "report.send_failed", entityType: "client_report", entityId: rep.id, clientId: rep.clientId, summary: `Sending the ${monthLabel(rep.month)} report failed: ${res.error}` });
    return { status: "failed", message: res.error };
  }
  await afterSent(claimed, a, to, true);
  return { status: "sent", message: `Sent to ${to}.` };
}

/** For a report sent by hand (copied into someone's own email). People only. */
export async function markReportSent(reportId: string, actor: string, sentTo?: string | null) {
  const a = Actor.parse(actor);
  if (!isPerson(a)) throw new OpsError("Only Nora or Cameron can mark a report sent.");
  const db = await getDb();
  const r = schema.clientReports;
  const [found] = await db.select().from(r).where(eq(r.id, reportId));
  if (!found) throw new OpsError("That report doesn't exist anymore.");
  if (found.audience !== "external") throw new OpsError("Internal reports are never sent.");
  const rep = found.status === "approved" ? await syncApprovedBody(found) : found;
  if (rep.status !== "approved") throw new OpsError(rep.status === "sent" ? "Already marked sent." : "Approve the report in Review first.");
  const client = await getBusiness(rep.clientId);
  const to = (sentTo?.trim() || client.ownerEmail || "").toLowerCase() || null;
  if (to && !z.email().safeParse(to).success) throw new OpsError(`“${to}” doesn't look like an email address.`);
  const [row] = await db.update(r).set({ status: "sent", sentAt: new Date(), sentTo: to, updatedAt: new Date() })
    .where(and(eq(r.id, rep.id), eq(r.status, "approved"))).returning();
  if (!row) throw new OpsError("Someone already marked it sent.");
  await afterSent(row, a, to, false);
}

async function afterSent(rep: ClientReport, actor: string, to: string | null, byApi: boolean) {
  if (rep.draftId) {
    try {
      await markDraftSent(rep.draftId, actor, { sentByApi: true });
    } catch {
      /* the draft may have been removed; the report itself is the record */
    }
  }
  await logActivity({
    actor, action: "report.sent", entityType: "client_report", entityId: rep.id, clientId: rep.clientId,
    summary: `${byApi ? "Emailed" : "Marked sent"}: the ${monthLabel(rep.month)} report${to ? ` to ${to}` : ""}`,
  });
}

/** Plain-text email from the shared Gmail inbox — like sendOutreachEmail but without the outreach opt-out footer. */
async function sendPlainEmail(args: { to: string; subject: string; body: string }): Promise<{ ok: true } | { ok: false; error: string; notConfigured?: boolean }> {
  const { gmailConfigured } = await import("./integrations/gmail");
  const { findConnection } = await import("./integrations/connections");
  const { googleAccessToken, friendlyGoogleError } = await import("./integrations/google-auth");
  const { fetchJson } = await import("./integrations/http");
  if (!gmailConfigured()) return { ok: false, notConfigured: true, error: "Gmail isn't connected" };
  const conn = await findConnection("gmail", null);
  if (!conn) return { ok: false, notConfigured: true, error: "Gmail isn't connected" };
  const t = await googleAccessToken(conn);
  if (!t.ok) return { ok: false, error: t.error };
  const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim();
  const word = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`);
  const address = (conn.externalId ?? conn.label).toLowerCase();
  const sender = oneLine(process.env.OUTREACH_FROM_NAME?.trim() || conn.label.split("@")[0]).replace(/"/g, "");
  const b64 = Buffer.from(args.body.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n"), "utf8").toString("base64").replace(/.{1,76}/g, "$&\r\n");
  const headers = [
    `From: ${word(sender)} <${address}>`,
    `To: ${oneLine(args.to)}`,
    `Subject: ${word(oneLine(args.subject))}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  ];
  const raw = Buffer.from(`${headers.join("\r\n")}\r\n\r\n${b64}`, "utf8").toString("base64url");
  try {
    await fetchJson("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${t.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw }),
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: friendlyGoogleError(e, "Gmail") };
  }
}

/* ───────────────────────── Owner email ───────────────────────── */

export async function setClientOwnerEmail(clientId: string, email: string | null, actor: string) {
  const a = Actor.parse(actor);
  if (!isPerson(a)) throw new OpsError("Only Nora or Cameron can change who receives reports.");
  const v = email?.trim().toLowerCase() || null;
  if (v && !z.email().safeParse(v).success) throw new OpsError(`“${v}” doesn't look like an email address.`);
  const client = await getBusiness(clientId);
  if ((client.ownerEmail ?? null) === v) return;
  const db = await getDb();
  await db.update(schema.clients).set({ ownerEmail: v }).where(eq(schema.clients.id, clientId));
  await logActivity({ actor: a, action: "client.updated", entityType: "client", entityId: clientId, clientId, summary: v ? `Owner email for reports: ${v}` : "Removed the owner email for reports" });
}

/* ───────────────────────── Reads ───────────────────────── */

export type ReportRow = ClientReport & { draftStatus: schema.DraftStatus | null; draftBody: string | null };

/** Every report for a business, newest month first. For a pending external report, `draftBody` is the text as edited in Review. */
export async function listClientReports(clientId: string): Promise<ReportRow[]> {
  const db = await getDb();
  const rows = await db.select({ r: schema.clientReports, ds: schema.drafts.status, db: schema.drafts.body }).from(schema.clientReports)
    .leftJoin(schema.drafts, eq(schema.drafts.id, schema.clientReports.draftId))
    .where(eq(schema.clientReports.clientId, clientId))
    .orderBy(desc(schema.clientReports.month), asc(schema.clientReports.audience));
  return rows.map(({ r, ds, db: body }) => ({ ...r, draftStatus: ds ?? null, draftBody: body ?? null }));
}

/* ───────────────────────── Monthly kickoff (cron) ───────────────────────── */

const kickoffBody = (business: string, month: string) =>
  `Draft the internal and external ${monthLabel(month)} reports for ${business} (get_report_metrics then create_report twice)`;

/**
 * One ask to Claude per active business per month to draft that month's two reports. Idempotent: skips a
 * business that already has the ask (any status) or both reports. With no `month`, reports on last month and
 * only acts during the first 7 days of the month (so a daily cron can call it every day).
 */
export async function requestReportDrafts(clientId: string, month: string, actor: string) {
  const a = Actor.parse(actor);
  Month.parse(month);
  const client = await getBusiness(clientId);
  const db = await getDb();
  const body = kickoffBody(client.name, month);
  const [existing] = await db.select({ id: schema.asks.id }).from(schema.asks)
    .where(and(eq(schema.asks.clientId, clientId), like(schema.asks.body, `${body.replace(/[%_\\]/g, "\\$&")}%`), inArray(schema.asks.status, ["new", "in_progress"]))).limit(1);
  if (existing) return { askId: existing.id, created: false };
  const { createRoutedAsk } = await import("./ops-asks");
  const { id } = await createRoutedAsk({ clientId, body }, { kind: "request", forWho: "claude" }, a);
  return { askId: id, created: true };
}

export async function monthlyReportKickoff(month?: string, now = new Date()) {
  if (month === undefined) {
    const day = Number(today(now).slice(8, 10));
    if (day > 7) return { month: addMonths(currentMonth(now), -1), created: 0, skipped: 0, note: "Only runs in the first week of the month." };
  }
  const m = month ?? addMonths(currentMonth(now), -1);
  Month.parse(m);
  const db = await getDb();
  const businesses = await db.select().from(schema.clients)
    .where(and(eq(schema.clients.archived, false), ne(schema.clients.kind, "creator"))).orderBy(asc(schema.clients.sortOrder));
  let created = 0;
  let skipped = 0;
  for (const c of businesses) {
    const body = kickoffBody(c.name, m);
    const [[ask], reports] = await Promise.all([
      // Any status: once asked this month, never ask again (even if Claude already closed it).
      db.select({ id: schema.asks.id }).from(schema.asks).where(and(eq(schema.asks.clientId, c.id), like(schema.asks.body, `${body.replace(/[%_\\]/g, "\\$&")}%`))).limit(1),
      db.select({ audience: schema.clientReports.audience }).from(schema.clientReports).where(and(eq(schema.clientReports.clientId, c.id), eq(schema.clientReports.month, m))),
    ]);
    if (ask || reports.length >= 2) { skipped++; continue; }
    const { createRoutedAsk } = await import("./ops-asks");
    await createRoutedAsk({ clientId: c.id, body }, { kind: "request", forWho: "claude" }, "system");
    created++;
  }
  return { month: m, created, skipped };
}

/** Months to offer on the reports page: every month with a report, plus the last three. */
export function reportMonths(reports: Pick<ClientReport, "month">[], now = new Date()): string[] {
  const cur = currentMonth(now);
  const set = new Set([addMonths(cur, -1), addMonths(cur, -2), cur, ...reports.map((r) => r.month)]);
  return [...set].filter(isMonth).sort().reverse();
}
