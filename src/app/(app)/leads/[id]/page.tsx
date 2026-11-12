import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getLead, leadDrafts } from "@/lib/ops-leads";
import { LEAD_STAGES } from "@/lib/schema";
import { formatDate, relativeTime, today as todayStr } from "@/lib/dates";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/client-form";
import { LeadFields } from "@/components/lead-fields";
import { NewClientLink } from "@/components/onboard-link";
import { NextStep, OppChips, ScoreBar } from "@/components/lead-bits";
import { OutreachStageSelect } from "@/components/outreach-stage-select";
import { Badge, Card, LinkButton, PageHeader, StatusBadge, cx } from "@/components/ui";
import { askPitchAction, deleteLeadAction, moveLeadStageAction, saveFollowUpAction, updateLeadAction } from "../actions";
import { CONVERT_STAGES, NO_CONTACT_STAGES, STAGE_LABEL, googleMapsHref, igHref, leadSignals, ttHref, websiteUrl } from "../shared";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

const STAGE_TONE: Record<string, "neutral" | "info" | "accent" | "ok" | "danger"> = {
  found: "neutral", qualified: "info", contacted: "info", talking: "accent", proposal: "accent", won: "ok", lost: "neutral", not_a_fit: "neutral",
};

export default async function LeadPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  await requireUser();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const lead = await getLead(id);
  if (!lead) notFound();
  const drafts = await leadDrafts(id);
  const today = todayStr();
  const s = leadSignals(lead);
  const web = websiteUrl(lead.website);
  const flash = one(sp.merged) ? "It was already on the list, so we updated that lead instead of adding a duplicate." : one(sp.added) ? "Lead added." : "";
  const error = one(sp.error);
  const back = `/leads/${lead.id}`;
  const closedOut = NO_CONTACT_STAGES.includes(lead.stage);
  const canConvert = CONVERT_STAGES.includes(lead.stage) && !lead.convertedClientId;
  const canPitch = !closedOut && !lead.convertedClientId && lead.stage !== "won";
  const channels = [
    lead.contactEmail ? { value: "email", label: "Email", hint: lead.contactEmail } : null,
    lead.instagramHandle ? { value: "instagram_dm", label: "Instagram DM", hint: `@${lead.instagramHandle}` } : null,
    lead.tiktokHandle ? { value: "tiktok_dm", label: "TikTok DM", hint: `@${lead.tiktokHandle}` } : null,
  ].filter((c): c is { value: string; label: string; hint: string } => !!c);
  const pending = drafts.find((d) => ["needs_review", "approved", "rejected"].includes(d.status));

  return (
    <>
      <p className="mb-2 text-sm">
        <Link href="/leads" className="text-muted hover:underline">← Leads</Link>
      </p>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {lead.name}
            <Badge tone={STAGE_TONE[lead.stage]}>{STAGE_LABEL[lead.stage]}</Badge>
          </span>
        }
        subtitle={[lead.city, lead.category, lead.source ? `Source: ${lead.source}` : null].filter(Boolean).join(" · ") || undefined}
        actions={
          <form action={moveLeadStageAction}>
            <input type="hidden" name="id" value={lead.id} />
            <input type="hidden" name="back" value={back} />
            <OutreachStageSelect current={lead.stage} label="Stage" stages={LEAD_STAGES} />
          </form>
        }
      />

      {flash && <p role="status" className="mb-4 rounded-lg bg-ok-soft px-3 py-2 text-sm text-ok">{flash}</p>}
      {error && <p role="alert" className="mb-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-5">
          {/* Why + the one next action */}
          <Card title="Why they’re a fit">
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <OppChips opportunities={lead.opportunities} />
              <ScoreBar score={lead.score} />
            </div>
            {lead.why ? <p className="whitespace-pre-line text-[15px] leading-relaxed">{lead.why}</p> : <p className="text-sm text-muted">Claude hasn’t written this yet.</p>}
            {(s.google || s.social) && (
              <ul className="mt-3 space-y-1 text-sm text-muted">
                {s.google && <li><span className="font-medium text-google">Google</span> · {s.google}</li>}
                {s.social && <li><span className="font-medium text-ig">Instagram</span> · {s.social}</li>}
              </ul>
            )}
          </Card>

          {lead.convertedClientId ? (
            <Card title="Now a client">
              <p className="mb-3 text-sm">You’re managing this business.</p>
              <LinkButton href={`/clients/${lead.convertedClientId}`} variant="primary">Open business page</LinkButton>
            </Card>
          ) : canConvert ? (
            <Card title="Start managing this business">
              <p className="mb-3 text-sm text-muted">One screen, prefilled from this lead: sets up the plan and checklist, hands research to Claude, and marks the lead Won.</p>
              <NewClientLink leadId={lead.id} size="md">Start managing {lead.name}</NewClientLink>
            </Card>
          ) : null}

          {canPitch && (
            <Card title={lead.stage === "contacted" ? "Follow up" : "Pitch them"}>
              {pending ? (
                <div className="space-y-2 text-sm">
                  <p>
                    A pitch is {pending.status === "needs_review" ? "waiting for your review" : pending.status === "approved" ? "approved and ready to send" : "sent back to Claude"}.
                  </p>
                  <LinkButton href="/review" variant="primary">Open Review</LinkButton>
                </div>
              ) : channels.length === 0 ? (
                <p className="text-sm text-muted">
                  No public email or Instagram saved yet. <a href="#edit" className="text-accent hover:underline">Add one</a>, or ask Claude to find it from the Asks page.
                </p>
              ) : (
                <ActionForm action={askPitchAction.bind(null, lead.id)} className="space-y-3" ariaLabel="Ask Claude to draft a pitch">
                  <fieldset>
                    <legend className="label">How to reach them</legend>
                    <div className="grid gap-2 sm:grid-cols-3">
                      {channels.map((c, i) => (
                        <label key={c.value} className="flex min-h-11 cursor-pointer items-start gap-2 rounded-lg border border-border px-3 py-2 has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
                          <input type="radio" name="channel" value={c.value} defaultChecked={i === 0} className="mt-0.5 shrink-0" />
                          <span className="min-w-0 text-sm leading-tight">
                            <span className="block font-medium">{c.label}</span>
                            <span className="block truncate text-xs text-muted">{c.hint}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <details className="group">
                    <summary className="no-marker inline-flex min-h-11 cursor-pointer items-center text-sm text-muted hover:text-text md:min-h-8">+ Add a note for Claude</summary>
                    <textarea name="note" rows={2} maxLength={1000} className="input mt-1" placeholder="e.g. mention we love their dumplings" />
                  </details>
                  <SubmitButton pendingLabel="Asking…">Ask Claude to draft a pitch</SubmitButton>
                  <p className="text-xs text-muted">You’ll approve it in Review before anything is sent.</p>
                </ActionForm>
              )}
            </Card>
          )}

          <Card title="Pitches" actions={drafts.length > 0 ? <Link href="/review" className="text-xs text-accent hover:underline">Review queue</Link> : undefined}>
            {drafts.length === 0 ? (
              <p className="text-sm text-muted">No pitches yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {drafts.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <span className="min-w-0">
                      <Link href="/review" className="font-medium hover:underline">{d.title}</Link>
                      <span className="block text-xs text-muted">
                        {d.kind === "lead_email" ? `Email${d.meta.to ? ` to ${String(d.meta.to)}` : ""}` : d.meta.channel === "tiktok_dm" ? "TikTok DM" : "Instagram DM"}
                        {" · "}
                        {d.sentAt ? `sent ${formatDate(d.sentAt)}` : relativeTime(d.createdAt)}
                      </span>
                    </span>
                    <StatusBadge status={d.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="Links">
            <ul className="space-y-2 text-sm">
              {web && <LinkRow label="Website" href={web} text={lead.website!.replace(/^https?:\/\//, "").replace(/\/$/, "")} />}
              <LinkRow label="Google Maps" href={googleMapsHref(lead)} text={lead.googleMapsUrl ? "Open on Google Maps" : "Search on Google Maps"} />
              {lead.instagramHandle && <LinkRow label="Instagram" href={igHref(lead.instagramHandle)} text={`@${lead.instagramHandle}`} />}
              {lead.tiktokHandle && <LinkRow label="TikTok" href={ttHref(lead.tiktokHandle)} text={`@${lead.tiktokHandle}`} />}
            </ul>
          </Card>

          <Card title="Contact">
            {lead.contactName || lead.contactEmail || lead.contactPhone ? (
              <ul className="space-y-1 text-sm">
                {lead.contactName && <li>{lead.contactName}</li>}
                {lead.contactEmail && <li><a href={`mailto:${lead.contactEmail}`} className="break-all hover:underline">{lead.contactEmail}</a></li>}
                {lead.contactPhone && <li><a href={`tel:${lead.contactPhone.replace(/[^\d+]/g, "")}`} className="hover:underline">{lead.contactPhone}</a></li>}
              </ul>
            ) : (
              <p className="text-sm text-muted">None saved.</p>
            )}
            <p className="mt-3 text-xs text-muted">
              Public business contact info only. If they say they’re not interested, set the stage to Lost — nobody can pitch them again. Emails include an opt-out line.
            </p>
          </Card>

          <Card title="Next step & notes">
            <ActionForm action={saveFollowUpAction.bind(null, lead.id)} className="space-y-3" ariaLabel="Next step and notes">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <label className="label" htmlFor="ld-next">Next step</label>
                  <NextStep date={lead.nextStepAt} today={today} />
                </div>
                <input id="ld-next" name="nextStepAt" type="date" defaultValue={lead.nextStepAt ?? ""} className="input" />
              </div>
              <div>
                <label className="label" htmlFor="ld-notes">Notes</label>
                <textarea id="ld-notes" name="notes" rows={4} defaultValue={lead.notes ?? ""} className="input" />
              </div>
              <SubmitButton variant="secondary">Save</SubmitButton>
            </ActionForm>
          </Card>
        </div>
      </div>

      <section id="edit" className="mt-8 scroll-mt-20">
        <details className="group rounded-xl border border-border bg-surface">
          <summary className="no-marker flex min-h-12 cursor-pointer items-center justify-between px-4 text-sm font-semibold">
            Edit details
            <svg viewBox="0 0 16 16" aria-hidden className="size-3.5 transition group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth={1.8}><path d="m4 6 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </summary>
          <div className="border-t border-border p-4">
            <ActionForm action={updateLeadAction.bind(null, lead.id)} className="space-y-4" ariaLabel="Edit lead">
              <LeadFields lead={lead} idPrefix="edit" openMore />
              <div className="sticky-actions flex flex-wrap items-center gap-2 rounded-xl bg-surface/95 py-2 backdrop-blur">
                <SubmitButton>Save changes</SubmitButton>
              </div>
            </ActionForm>
            <form action={deleteLeadAction.bind(null, lead.id)} className="mt-6 border-t border-border pt-4">
              <ConfirmButton confirm={`Delete ${lead.name}? Any unsent pitches to them are withdrawn.`}>Delete lead</ConfirmButton>
            </form>
          </div>
        </details>
      </section>

      <p className={cx("mt-4 text-xs text-muted")}>Added {formatDate(lead.createdAt)} · updated {relativeTime(lead.updatedAt)}</p>
    </>
  );
}

function LinkRow({ label, href, text }: { label: string; href: string; text: string }) {
  return (
    <li className="flex min-h-11 items-center justify-between gap-3 md:min-h-8">
      <span className="text-xs font-medium text-muted">{label}</span>
      <a href={href} target="_blank" rel="noopener noreferrer" className="min-w-0 truncate text-right hover:underline">{text} ↗</a>
    </li>
  );
}
