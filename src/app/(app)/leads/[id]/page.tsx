import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser, seesDrafts } from "@/lib/auth";
import { getLead, leadDrafts } from "@/lib/ops-leads";
import { LEAD_STAGES } from "@/lib/schema";
import { formatDate, relativeTime, today as todayStr } from "@/lib/dates";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/client-form";
import { LeadFields } from "@/components/lead-fields";
import { NewClientLink } from "@/components/onboard-link";
import { NextStep, OppChips, ScoreBar } from "@/components/lead-bits";
import { OutreachStageSelect } from "@/components/outreach-stage-select";
import { Card, LinkButton, PageHeader, Status, StatusBadge } from "@/components/ui";
import { askPitchAction, deleteLeadAction, moveLeadStageAction, saveFollowUpAction, updateLeadAction } from "../actions";
import { CONVERT_STAGES, NO_CONTACT_STAGES, STAGE_LABEL, googleMapsHref, igHref, leadSignals, ttHref, websiteUrl } from "../shared";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

const STAGE_TONE: Record<string, "neutral" | "info" | "ink" | "ok" | "danger"> = {
  found: "neutral", qualified: "info", contacted: "info", talking: "ink", proposal: "ink", won: "ok", lost: "neutral", not_a_fit: "neutral",
};

export default async function LeadPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const viewer = await requireUser();
  const showDrafts = seesDrafts(viewer); // pitches are drafts: Cameron's side only
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

  const facts = [lead.city, lead.category, lead.source ? `Source: ${lead.source}` : null].filter(Boolean).join(" · ");

  return (
    <>
      <PageHeader
        crumb={<Link href="/leads">Leads</Link>}
        title={lead.name}
        subtitle={
          <span className="g-meta">
            <Status tone={STAGE_TONE[lead.stage]}>{STAGE_LABEL[lead.stage]}</Status>
            {facts && <span>{facts}</span>}
          </span>
        }
        actions={
          <form action={moveLeadStageAction}>
            <input type="hidden" name="id" value={lead.id} />
            <input type="hidden" name="back" value={back} />
            <OutreachStageSelect current={lead.stage} label="Stage" stages={LEAD_STAGES} />
          </form>
        }
      />

      {flash && <p role="status" className="notice mb-2"><span className="status is-ok">{flash}</span></p>}
      {error && <p role="alert" className="notice mb-2"><span className="status is-danger">{error}</span></p>}

      <div className="cols mt-0">
        <div>
          {/* Why + the one next action */}
          <Card title="Why they’re a fit">
            <div className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-2">
              <OppChips opportunities={lead.opportunities} />
              <ScoreBar score={lead.score} />
            </div>
            {lead.why ? <p className="whitespace-pre-line">{lead.why}</p> : <p className="meta">Claude hasn’t written this yet.</p>}
            {(s.google || s.social) && (
              <ul className="list is-ruled mt-4">
                {s.google && <li className="py-2"><span className="status is-google">Google</span><span className="meta"> · {s.google}</span></li>}
                {s.social && <li className="py-2"><span className="status is-ig">Instagram</span><span className="meta"> · {s.social}</span></li>}
              </ul>
            )}
          </Card>

          {lead.convertedClientId ? (
            <Card title="Now a client">
              <p className="mb-4">You’re managing this business.</p>
              <LinkButton href={`/clients/${lead.convertedClientId}`} variant="secondary">Open business page</LinkButton>
            </Card>
          ) : canConvert ? (
            <Card title="Start managing this business">
              <p className="meta mb-4">One screen, prefilled from this lead: sets up the plan and checklist, hands research to Claude, and marks the lead Won.</p>
              {/* A long business name is cut with an ellipsis inside the button; it used to run off a phone's right edge. */}
              <NewClientLink leadId={lead.id} size="md" className="max-w-full">
                <span className="min-w-0 truncate">Start managing {lead.name}</span>
              </NewClientLink>
            </Card>
          ) : null}

          {canPitch && showDrafts && (
            <Card title={lead.stage === "contacted" ? "Follow up" : "Pitch them"}>
              {pending ? (
                <div className="space-y-3">
                  <p>
                    A pitch is {pending.status === "needs_review" ? "waiting for your review" : pending.status === "approved" ? "approved and ready to send" : "sent back to Claude"}.
                  </p>
                  <LinkButton href="/review">Open Review</LinkButton>
                </div>
              ) : channels.length === 0 ? (
                <p className="meta">
                  No public email or Instagram saved yet. <a href="#edit" className="link">Add one</a>, or ask Claude to find it from the Asks page.
                </p>
              ) : (
                <ActionForm action={askPitchAction.bind(null, lead.id)} className="space-y-3" ariaLabel="Ask Claude to draft a pitch">
                  <fieldset>
                    <legend className="label">How to reach them</legend>
                    <div className="g-opts is-3">
                      {channels.map((c, i) => (
                        <label key={c.value} className="g-opt">
                          <input type="radio" name="channel" value={c.value} defaultChecked={i === 0} className="check" />
                          <span>
                            <b>{c.label}</b>
                            <small className="truncate">{c.hint}</small>
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <details className="g-disc is-quiet">
                    <summary>
                      Add a note for Claude
                      <svg viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M6 3.5 10.5 8 6 12.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </summary>
                    <textarea name="note" rows={2} maxLength={1000} className="input mt-1" placeholder="e.g. mention we love their dumplings" aria-label="Note for Claude" />
                  </details>
                  <SubmitButton pendingLabel="Asking…">Ask Claude to draft a pitch</SubmitButton>
                  <p className="hint">You’ll approve it in Review before anything is sent.</p>
                </ActionForm>
              )}
            </Card>
          )}

          {showDrafts && (
          <Card title="Pitches" actions={drafts.length > 0 ? <Link href="/review" className="link-quiet">Review queue →</Link> : undefined} padded={drafts.length === 0}>
            {drafts.length === 0 ? (
              <p className="meta">No pitches yet.</p>
            ) : (
              <ul className="list">
                {drafts.map((d) => (
                  <li key={d.id} className="g-row">
                    <Link href="/review" className="row-title">{d.title}</Link>
                    <span className="end"><StatusBadge status={d.status} /></span>
                    <p className="more">
                      {d.kind === "lead_email" ? `Email${d.meta.to ? ` to ${String(d.meta.to)}` : ""}` : d.meta.channel === "tiktok_dm" ? "TikTok DM" : "Instagram DM"}
                      {" · "}
                      {d.sentAt ? `sent ${formatDate(d.sentAt)}` : relativeTime(d.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          )}
        </div>

        <aside>
          <Card title="Links">
            <dl className="g-kv">
              {web && <LinkRow label="Website" href={web} text={lead.website!.replace(/^https?:\/\//, "").replace(/\/$/, "")} />}
              <LinkRow label="Google Maps" href={googleMapsHref(lead)} text={lead.googleMapsUrl ? "Open on Google Maps" : "Search on Google Maps"} />
              {lead.instagramHandle && <LinkRow label="Instagram" href={igHref(lead.instagramHandle)} text={`@${lead.instagramHandle}`} />}
              {lead.tiktokHandle && <LinkRow label="TikTok" href={ttHref(lead.tiktokHandle)} text={`@${lead.tiktokHandle}`} />}
            </dl>
          </Card>

          <Card title="Contact">
            {lead.contactName || lead.contactEmail || lead.contactPhone ? (
              <ul className="space-y-1">
                {lead.contactName && <li>{lead.contactName}</li>}
                {lead.contactEmail && <li><a href={`mailto:${lead.contactEmail}`} className="link break-all">{lead.contactEmail}</a></li>}
                {lead.contactPhone && <li><a href={`tel:${lead.contactPhone.replace(/[^\d+]/g, "")}`} className="link">{lead.contactPhone}</a></li>}
              </ul>
            ) : (
              <p className="meta">None saved.</p>
            )}
            <p className="hint mt-3">
              Public business contact info only. If they say they’re not interested, set the stage to Lost and nobody can pitch them again. Emails include an opt-out line.
            </p>
          </Card>

          <Card title="Next step & notes">
            <ActionForm action={saveFollowUpAction.bind(null, lead.id)} className="space-y-4" ariaLabel="Next step and notes">
              <div>
                <div className="flex items-baseline justify-between gap-2">
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
        </aside>
      </div>

      {/* Under the two columns, in the main column's track (.cols with one child), so its rule ends where theirs does. */}
      <div id="edit" className="cols scroll-mt-20">
        <div>
          <details className="sec g-fold">
            <summary className="sec-head">
              <span className="title">Edit details</span>
              <svg viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M6 3.5 10.5 8 6 12.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </summary>
            <div className="sec-body">
              <ActionForm action={updateLeadAction.bind(null, lead.id)} className="space-y-4" ariaLabel="Edit lead">
                <LeadFields lead={lead} idPrefix="edit" openMore />
                <div className="sticky-actions action-bar flex flex-wrap items-center gap-x-3 gap-y-2">
                  <SubmitButton variant="secondary">Save changes</SubmitButton>
                </div>
              </ActionForm>
              <form action={deleteLeadAction.bind(null, lead.id)} className="mt-8">
                <ConfirmButton confirm={`Delete ${lead.name}? Any unsent pitches to them are withdrawn.`}>Delete lead</ConfirmButton>
              </form>
            </div>
          </details>
        </div>
      </div>

      <p className="meta mt-8">Added {formatDate(lead.createdAt)} · updated {relativeTime(lead.updatedAt)}</p>
    </>
  );
}

function LinkRow({ label, href, text }: { label: string; href: string; text: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd><a href={href} target="_blank" rel="noopener noreferrer" className="link tap-target">{text} ↗</a></dd>
    </div>
  );
}
