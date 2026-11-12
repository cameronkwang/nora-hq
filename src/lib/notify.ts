import "server-only";
import { createHash } from "node:crypto";
import { after } from "next/server";
import { count, eq, inArray, lt } from "drizzle-orm";
import webpush from "web-push";
import { getDb, schema } from "./db";
import { allowedUsers } from "./auth";
import type { NotifyTopic } from "./schema";

/**
 * Phone notifications (Web Push). Server side only; the app never calls an LLM here.
 *
 *  - sendToUser / sendToAll: deliver to every device a person subscribed, filtered by that device's topics.
 *    Never throw into callers: failures are logged and swallowed. No-op when VAPID env vars are missing.
 *  - notify* hooks: called from ops functions AFTER their DB write succeeded. Fire-and-forget: scheduled with
 *    next/server `after()` so the request isn't slowed down and Vercel keeps the function alive until it's done.
 *
 * Env: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:you@example.com or https://your-app).
 * Generate keys once: npx web-push generate-vapid-keys
 */

export type PushPayload = { title: string; body: string; url?: string; tag?: string };
export type SendResult = { sent: number; removed: number; failed: number; skipped?: "not_configured" | "no_devices" | "throttled" };

const TTL: Record<NotifyTopic, number> = {
  collab_request: 2 * 86400,
  ask_for_me: 86400,
  drafts_waiting: 6 * 3600,
  payment_overdue: 86400,
  visit_reminder: 18 * 3600,
};
const URGENCY: Record<NotifyTopic, "normal" | "high"> = {
  collab_request: "high",
  ask_for_me: "high",
  drafts_waiting: "normal",
  payment_overdue: "normal",
  visit_reminder: "high",
};
/** drafts_waiting: at most one per person per this window. */
const DRAFTS_THROTTLE_MS = 2 * 3600_000;

/* ───────────────────────── Config ───────────────────────── */

export function vapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY?.trim() || null;
}

function vapidDetails() {
  const publicKey = vapidPublicKey();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return null;
  let subject = process.env.VAPID_SUBJECT?.trim() || process.env.APP_URL?.trim() || "";
  // Apple rejects localhost / non-https subjects; a mailto: or a public https URL is required.
  if (!/^mailto:.+@.+/.test(subject) && !/^https:\/\//.test(subject)) {
    const first = allowedUsers()[0]?.email;
    subject = first && first.includes("@") && !first.endsWith("@local") ? `mailto:${first}` : "mailto:noreply@example.com";
  }
  return { subject, publicKey, privateKey };
}

export function pushConfigured(): boolean {
  return vapidDetails() !== null;
}

/* ───────────────────────── People ───────────────────────── */

/** Email of "nora" / "cameron" from APP_USERS (matched by first name), or null. */
export function personEmail(person: "nora" | "cameron"): string | null {
  return allowedUsers().find((u) => u.name.toLowerCase().split(" ")[0] === person)?.email ?? null;
}

function nameOf(actor: string): string {
  if (actor === "claude") return "Claude";
  if (actor === "public" || actor === "system") return "Someone";
  return allowedUsers().find((u) => u.email === actor)?.name.split(" ")[0] ?? "Someone";
}

/* ───────────────────────── Sending ───────────────────────── */

const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};

/** Push "Topic" header: collapses still-undelivered notifications with the same key (max 32 url-safe chars). */
const pushTopicKey = (tag: string) => createHash("sha256").update(tag).digest("base64url").slice(0, 32);

type Sub = typeof schema.pushSubscriptions.$inferSelect;

async function deliver(subs: Sub[], topic: NotifyTopic, payload: PushPayload): Promise<SendResult> {
  const vapid = vapidDetails();
  const result: SendResult = { sent: 0, removed: 0, failed: 0 };
  if (!vapid || subs.length === 0) return result;
  const body = JSON.stringify({
    title: clip(payload.title, 80),
    body: clip(payload.body, 240),
    url: payload.url && payload.url.startsWith("/") ? payload.url : "/",
    tag: payload.tag ?? topic,
  });
  const db = await getDb();
  const gone: string[] = [];
  const ok: string[] = [];
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, {
          vapidDetails: vapid,
          TTL: TTL[topic],
          urgency: URGENCY[topic],
          topic: pushTopicKey(payload.tag ?? topic),
          timeout: 10_000,
        });
        ok.push(s.id);
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) gone.push(s.id); // device unsubscribed or the subscription expired
        else {
          result.failed++;
          console.error("[notify] push failed", status ?? "", (e as Error).message ?? e);
        }
      }
    }),
  );
  if (ok.length) await db.update(schema.pushSubscriptions).set({ lastSentAt: new Date() }).where(inArray(schema.pushSubscriptions.id, ok));
  if (gone.length) await db.delete(schema.pushSubscriptions).where(inArray(schema.pushSubscriptions.id, gone));
  result.sent = ok.length;
  result.removed = gone.length;
  return result;
}

async function subsFor(email: string, topic: NotifyTopic | null) {
  const db = await getDb();
  const rows = await db.select().from(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.userEmail, email.trim().toLowerCase()));
  return topic ? rows.filter((r) => (r.topics ?? []).includes(topic)) : rows;
}

/**
 * Atomically claims a once-per-window slot in app_settings. Returns true if this caller may send.
 * (INSERT … ON CONFLICT DO UPDATE … WHERE updated_at < cutoff RETURNING — only one concurrent caller wins.)
 */
async function claimSlot(key: string, windowMs: number): Promise<boolean> {
  const db = await getDb();
  const cutoff = new Date(Date.now() - windowMs);
  const rows = await db.insert(schema.appSettings)
    .values({ key, value: { at: new Date().toISOString() }, updatedBy: "system" })
    .onConflictDoUpdate({
      target: schema.appSettings.key,
      set: { value: { at: new Date().toISOString() }, updatedAt: new Date(), updatedBy: "system" },
      setWhere: lt(schema.appSettings.updatedAt, cutoff),
    })
    .returning({ key: schema.appSettings.key });
  return rows.length > 0;
}

/** Sends to every device `email` subscribed for `topic`. Never throws. */
export async function sendToUser(email: string, topic: NotifyTopic, payload: PushPayload): Promise<SendResult> {
  try {
    if (!pushConfigured()) return { sent: 0, removed: 0, failed: 0, skipped: "not_configured" };
    const subs = await subsFor(email, topic);
    if (!subs.length) return { sent: 0, removed: 0, failed: 0, skipped: "no_devices" };
    if (topic === "drafts_waiting" && !(await claimSlot(`notify.throttle.drafts_waiting.${email.trim().toLowerCase()}`, DRAFTS_THROTTLE_MS))) {
      return { sent: 0, removed: 0, failed: 0, skipped: "throttled" };
    }
    return await deliver(subs, topic, payload);
  } catch (e) {
    console.error("[notify] sendToUser failed", topic, e);
    return { sent: 0, removed: 0, failed: 1 };
  }
}

/** Sends to everyone who can sign in (optionally except one email). Never throws. */
export async function sendToAll(topic: NotifyTopic, payload: PushPayload, opts: { except?: string | null } = {}): Promise<SendResult> {
  const except = opts.except?.trim().toLowerCase();
  const total: SendResult = { sent: 0, removed: 0, failed: 0 };
  for (const u of allowedUsers()) {
    if (u.email === except) continue;
    const r = await sendToUser(u.email, topic, payload);
    total.sent += r.sent;
    total.removed += r.removed;
    total.failed += r.failed;
  }
  return total;
}

/** A test notification to all of one person's devices, whatever their topics. Never throws. */
export async function sendTest(email: string): Promise<SendResult> {
  try {
    if (!pushConfigured()) return { sent: 0, removed: 0, failed: 0, skipped: "not_configured" };
    const subs = await subsFor(email, null);
    if (!subs.length) return { sent: 0, removed: 0, failed: 0, skipped: "no_devices" };
    return await deliver(subs, "ask_for_me", { title: "Nora HQ", body: "Notifications are working on this device ✓", url: "/settings/notifications", tag: `test-${Date.now()}` });
  } catch (e) {
    console.error("[notify] test failed", e);
    return { sent: 0, removed: 0, failed: 1 };
  }
}

/* ───────────────────────── Fire-and-forget hooks (called from ops) ───────────────────────── */

/** Runs `fn` after the response is sent (Vercel keeps the function alive), or right away outside a request. Never throws. */
function defer(label: string, fn: () => Promise<unknown>) {
  const run = () => fn().catch((e) => console.error(`[notify] ${label} failed`, e));
  try {
    after(run);
  } catch {
    void run(); // not inside a request (scripts, tests)
  }
}

/** New public collab request → Nora. */
export function notifyCollabRequest(r: { id: string; businessName: string; city?: string | null; compensation?: string | null }) {
  defer("collab_request", async () => {
    const nora = personEmail("nora");
    if (!nora) return;
    await sendToUser(nora, "collab_request", {
      title: `Collab request: ${r.businessName}`,
      body: [r.city, r.compensation].filter(Boolean).join(" · ") || "Tap to review it",
      url: `/collabs/${r.id}`,
      tag: `collab-${r.id}`,
    });
  });
}

type AskLike = { id: string; body: string; kind: string; forWho: string };

/**
 * Ask hooks (createRoutedAsk / triageAsk):
 *  - routed to Cameron or Nora as a request (on create, or when triage changes it to them) → that person;
 *  - a person posts an idea / FYI / question for "anyone" → the other person.
 * Never notifies the actor themself; "public" asks are skipped (the collab hook already told Nora).
 * Asks for Claude (or "Claude decides") don't notify anyone.
 */
export function notifyAsk(ask: AskLike, actor: string, prev?: { kind: string; forWho: string } | null) {
  defer("ask_for_me", async () => {
    if (actor === "public") return;
    const isPerson = (v: string): v is "nora" | "cameron" => v === "nora" || v === "cameron";
    let target: string | null = null;
    if (ask.kind === "request" && isPerson(ask.forWho)) {
      if (prev && prev.kind === ask.kind && prev.forWho === ask.forWho) return; // nothing changed
      target = personEmail(ask.forWho);
    } else if (!prev && ask.forWho === "anyone") {
      const me = allowedUsers().find((u) => u.email === actor);
      if (!me) return;
      const other = allowedUsers().find((u) => u.email !== me.email);
      target = other?.email ?? null;
    }
    if (!target || target === actor.trim().toLowerCase()) return;
    const label = ask.kind === "idea" ? "an idea" : ask.kind === "update" ? "an FYI" : ask.kind === "question" ? "a question" : "an ask for you";
    await sendToUser(target, "ask_for_me", {
      title: prev ? `New ask for you (sorted by ${nameOf(actor)})` : `${nameOf(actor)} sent ${label}`,
      body: ask.body,
      url: `/asks/${ask.id}`,
      tag: `ask-${ask.id}`,
    });
  });
}

/** New draft by Claude → both people (drafts_waiting, max one per person per 2h). */
export function notifyDraftCreated(d: { id: string; title: string }, actor: string) {
  if (actor !== "claude") return;
  defer("drafts_waiting", async () => {
    const db = await getDb();
    const [r] = await db.select({ n: count() }).from(schema.drafts).where(eq(schema.drafts.status, "needs_review"));
    const n = r?.n ?? 1;
    await sendToAll("drafts_waiting", {
      title: n === 1 ? "1 draft waiting for review" : `${n} drafts waiting for review`,
      body: `Latest: ${d.title}`,
      url: "/review",
      tag: "drafts-waiting",
    });
  });
}

