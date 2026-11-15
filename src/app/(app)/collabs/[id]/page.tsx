import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { formatDate, relativeTime } from "@/lib/dates";
import { collabAnswerGroups, collabLeadCreated, getCollabRequest } from "@/lib/ops-collab";
import { getLead, leadDrafts } from "@/lib/ops-leads";
import { ConfirmButton, SubmitButton } from "@/components/client-form";
import { CollabComp, CollabStatusBadge, CollabTypeChips } from "@/components/collab-bits";
import { Card, PageHeader, StatusBadge, cx } from "@/components/ui";
import { askCollabReplyAction, copyCollabContactAction, setCollabStatusAction } from "../actions";
import { createDealFromCollabAction } from "../../deals/actions";
import { dealForCollabRequest } from "@/lib/ops-deals";
import { DealStatusBadge } from "@/components/deal-bits";
import { STAGE_LABEL } from "../../leads/shared";
import { ReplyPicker } from "@/components/reply-picker";
import { firstName } from "@/components/reply-fill";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

const DONE_MSG: Record<string, string> = {
  accepted: "Accepted. Create the deal below when you’re ready; it’s pre-filled from the request.",
  declined: "Marked declined.",
  spam: "Marked as spam and cleared from Nora’s list.",
  reviewing: "Moved to reviewing.",
};

export default async function CollabRequestPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  await requireUser();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const req = await getCollabRequest(id);
  if (!req) notFound();
  const [[lead, drafts], deal] = await Promise.all([
    req.leadId ? Promise.all([getLead(req.leadId), leadDrafts(req.leadId)]) : Promise.resolve([null, []] as const),
    dealForCollabRequest(req.id),
  ]);
  const reply = drafts.find((d) => d.kind === "lead_email");
  const groups = collabAnswerGroups(req);
  const error = one(sp.error);
  const flash = one(sp.drafting) ? "Sent to Claude. The draft reply will show up in Review." : DONE_MSG[one(sp.done)] ?? "";
  const open = req.status === "new" || req.status === "reviewing";
  const ownLead = collabLeadCreated(req);
  const leadEmail = lead?.contactEmail ?? null;
  const contactDiffers = !!lead && (leadEmail ?? "").toLowerCase() !== req.email.toLowerCase();
  const flashMsg = one(sp.copied) ? "Contact details copied onto the lead." : flash;

  return (
    <>
      <PageHeader
        crumb={<Link href="/collabs">Collab requests</Link>}
        title={req.businessName}
        subtitle={
          <span className="g-meta">
            <CollabStatusBadge status={req.status} small={false} />
            <span>
              {[req.city, `from ${req.contactName}`].filter(Boolean).join(" · ")} · received{" "}
              <time dateTime={req.createdAt.toISOString()} title={formatDate(req.createdAt, true)}>{relativeTime(req.createdAt)}</time>
            </span>
          </span>
        }
      />

      {flashMsg && <p role="status" className="notice mb-2"><span className="status is-ok">{flashMsg}</span></p>}
      {error && <p role="alert" className="notice mb-2"><span className="status is-danger">{error}</span></p>}

      <div className="cols mt-0">
        <div>
          {/* At a glance */}
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2 border-b border-border pb-4">
            <CollabTypeChips types={req.collabType} />
            <CollabComp compensation={req.compensation} budget={req.budget} />
            {req.timeline && <span className="text-muted">{req.timeline}</span>}
          </div>

          {groups.map((g) => (
            <Card key={g.title} title={g.title} padded={false}>
              <dl className="g-kv is-wide">
                {g.items.map((it) => (
                  <div key={it.label}>
                    <dt>{it.label}</dt>
                    <dd className={cx(it.multiline && "whitespace-pre-line")}>
                      {it.href ? (
                        <a href={it.href} target={it.href.startsWith("http") ? "_blank" : undefined} rel="noreferrer" className="link">
                          {it.value}
                        </a>
                      ) : it.label === "Links" ? (
                        <Linkified text={it.value} />
                      ) : (
                        it.value
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </Card>
          ))}
        </div>

        <aside>
          <Card title="Decide">
            {open ? (
              <div className="flex flex-wrap gap-2">
                <form action={setCollabStatusAction}>
                  <input type="hidden" name="id" value={req.id} />
                  <input type="hidden" name="status" value="accepted" />
                  <SubmitButton pendingLabel="Saving…">Accept</SubmitButton>
                </form>
                <form action={setCollabStatusAction}>
                  <input type="hidden" name="id" value={req.id} />
                  <input type="hidden" name="status" value="declined" />
                  <ConfirmButton variant="secondary" size="md" confirm={ownLead ? "Mark this request declined? The lead moves to Lost and any unsent reply draft to them is withdrawn, so send your reply first." : "Mark this request declined? The lead was already in your pipeline, so its stage stays as it is."}>
                    Decline
                  </ConfirmButton>
                </form>
                <form action={setCollabStatusAction} className="ml-auto">
                  <input type="hidden" name="id" value={req.id} />
                  <input type="hidden" name="status" value="spam" />
                  <ConfirmButton variant="ghost" size="md" confirm="Mark as spam? It’s removed from Nora’s list and the ask is archived.">
                    Spam
                  </ConfirmButton>
                </form>
              </div>
            ) : (
              <form action={setCollabStatusAction} className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
                <input type="hidden" name="id" value={req.id} />
                <input type="hidden" name="status" value="reviewing" />
                <span className="meta">Decided: <CollabStatusBadge status={req.status} /></span>
                <SubmitButton variant="secondary" size="sm">Move back to reviewing</SubmitButton>
              </form>
            )}
            <p className="hint mt-3">
              {ownLead ? "Accept moves the lead to Talking. Decline moves it to Lost." : "This matched a lead you already had, so its stage stays as it is; the decision is noted on the lead."}
            </p>
          </Card>

          {(req.status === "accepted" || deal) && (
            <Card title="Deal">
              {deal ? (
                <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <DealStatusBadge status={deal.status} />
                  <Link href={`/deals/${deal.id}`} className="link">Open the deal →</Link>
                </p>
              ) : (
                <form action={createDealFromCollabAction} className="space-y-2">
                  <input type="hidden" name="collabRequestId" value={req.id} />
                  <SubmitButton pendingLabel="Creating…">Create deal</SubmitButton>
                  <p className="hint">Pre-filled from this request: contact, address, compensation, usage, menu/dietary/filming notes and deliverables. Claude is asked for a shot list.</p>
                </form>
              )}
            </Card>
          )}

          {req.status !== "spam" && (
            <Card title="Reply">
              {reply && (
                <p className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span>Draft reply</span> <StatusBadge status={reply.status} />
                  <Link href={`/review?draft=${reply.id}`} className="link">Open in Review →</Link>
                </p>
              )}
              <form action={askCollabReplyAction} className="space-y-3">
                <input type="hidden" name="id" value={req.id} />
                <div>
                  <label className="label" htmlFor="reply-note">Anything Claude should know? (optional)</label>
                  <textarea id="reply-note" name="note" rows={2} maxLength={1000} className="input min-h-0!" placeholder="e.g. say yes, suggest a Tuesday visit" />
                </div>
                <SubmitButton variant="secondary" pendingLabel="Sending…">Ask Claude to draft a reply</SubmitButton>
              </form>
              {contactDiffers && (
                <p className="hint mt-3">
                  Claude’s draft goes to the lead’s saved email ({leadEmail ?? "none saved"}), not {req.email}. Copy the form’s contact onto the lead below if this person should get it.
                </p>
              )}
              <div className="mt-4 flex flex-col items-start gap-1 border-t border-border pt-3">
                <a href={`mailto:${req.email}`} className="link break-all text-sm">Or email {req.email} yourself</a>
                <ReplyPicker context={{ name: firstName(req.contactName), business: req.businessName }} category="collab" label="Copy a saved reply" variant="ghost" size="sm" className="-ml-1.5" />
              </div>
            </Card>
          )}

          <Card title="Linked">
            <dl className="g-kv">
              <div>
                <dt>Lead</dt>
                <dd>
                  {lead ? (
                    <Link href={`/leads/${lead.id}`} className="link">{lead.name} · {STAGE_LABEL[lead.stage]}</Link>
                  ) : (
                    <span className="text-muted">None</span>
                  )}
                </dd>
              </div>
              {lead && contactDiffers && (
                <div className="block!">
                  <form action={copyCollabContactAction} className="flex flex-col items-start gap-2">
                    <input type="hidden" name="id" value={req.id} />
                    <span className="meta">Lead email: {leadEmail ?? "none"} · form: {req.email}</span>
                    <ConfirmButton variant="secondary" size="sm" confirm={`Replace the lead’s contact with ${req.contactName} <${req.email}>? Only do this if you trust this request came from the business.`}>
                      Use form contact on lead
                    </ConfirmButton>
                  </form>
                </div>
              )}
              <div>
                <dt>Ask for Nora</dt>
                <dd>{req.askId ? <Link href={`/asks/${req.askId}`} className="link">Open ask</Link> : <span className="text-muted">None</span>}</dd>
              </div>
            </dl>
          </Card>
        </aside>
      </div>
    </>
  );
}

/** Plain text with http(s) URLs turned into links. Nothing else is interpreted. */
function Linkified({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s<>"']+)/g);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <a key={i} href={p} target="_blank" rel="noreferrer nofollow" className="link break-all">{p}</a>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}
