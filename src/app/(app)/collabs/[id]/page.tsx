import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { formatDate, relativeTime } from "@/lib/dates";
import { collabAnswerGroups, collabLeadCreated, getCollabRequest } from "@/lib/ops-collab";
import { getLead, leadDrafts } from "@/lib/ops-leads";
import { ConfirmButton, SubmitButton } from "@/components/client-form";
import { CollabComp, CollabStatusBadge, CollabTypeChips } from "@/components/collab-bits";
import { Card, PageHeader, StatusBadge, buttonClass, cx } from "@/components/ui";
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
  accepted: "Accepted. Create the deal below when you’re ready — it’s pre-filled from the request.",
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
  const flash = one(sp.drafting) ? "Sent to Claude — the draft reply will show up in Review." : DONE_MSG[one(sp.done)] ?? "";
  const open = req.status === "new" || req.status === "reviewing";
  const ownLead = collabLeadCreated(req);
  const leadEmail = lead?.contactEmail ?? null;
  const contactDiffers = !!lead && (leadEmail ?? "").toLowerCase() !== req.email.toLowerCase();
  const flashMsg = one(sp.copied) ? "Contact details copied onto the lead." : flash;

  return (
    <>
      <p className="mb-2 text-sm">
        <Link href="/collabs" className="text-muted hover:underline">← Collab requests</Link>
      </p>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {req.businessName}
            <CollabStatusBadge status={req.status} />
          </span>
        }
        subtitle={
          <>
            {[req.city, `from ${req.contactName}`].filter(Boolean).join(" · ")} · received{" "}
            <time dateTime={req.createdAt.toISOString()} title={formatDate(req.createdAt, true)}>{relativeTime(req.createdAt)}</time>
          </>
        }
      />

      {flashMsg && <p role="status" className="mb-4 rounded-lg bg-ok-soft px-3 py-2 text-sm text-ok">{flashMsg}</p>}
      {error && <p role="alert" className="mb-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-5">
          {/* At a glance */}
          <div className="rounded-xl border border-border bg-surface p-4">
            <CollabTypeChips types={req.collabType} />
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              <CollabComp compensation={req.compensation} budget={req.budget} />
              {req.timeline && <span className="text-sm text-muted">{req.timeline}</span>}
            </div>
          </div>

          {groups.map((g) => (
            <Card key={g.title} title={g.title}>
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[11rem_minmax(0,1fr)]">
                {g.items.map((it) => (
                  <div key={it.label} className="contents">
                    <dt className="text-xs font-semibold text-muted sm:pt-0.5">{it.label}</dt>
                    <dd className={cx("-mt-2 break-words text-[15px] sm:mt-0", it.multiline && "whitespace-pre-line leading-relaxed")}>
                      {it.href ? (
                        <a href={it.href} target={it.href.startsWith("http") ? "_blank" : undefined} rel="noreferrer" className="text-accent hover:underline">
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

        <aside className="space-y-5">
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
                  <ConfirmButton variant="secondary" size="md" confirm={ownLead ? "Mark this request declined? The lead moves to Lost and any unsent reply draft to them is withdrawn — send your reply first." : "Mark this request declined? The lead was already in your pipeline, so its stage stays as it is."}>
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
              <form action={setCollabStatusAction} className="flex flex-wrap items-center gap-3">
                <input type="hidden" name="id" value={req.id} />
                <input type="hidden" name="status" value="reviewing" />
                <span className="text-sm text-muted">Decided: <CollabStatusBadge status={req.status} /></span>
                <SubmitButton variant="secondary" size="sm">Move back to reviewing</SubmitButton>
              </form>
            )}
            <p className="mt-3 text-xs text-muted">
              {ownLead ? "Accept moves the lead to Talking. Decline moves it to Lost." : "This matched a lead you already had, so its stage stays as it is — the decision is noted on the lead."}
            </p>
          </Card>

          {(req.status === "accepted" || deal) && (
            <Card title="Deal">
              {deal ? (
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  <DealStatusBadge status={deal.status} />
                  <Link href={`/deals/${deal.id}`} className="font-medium text-accent hover:underline">Open the deal →</Link>
                </p>
              ) : (
                <form action={createDealFromCollabAction} className="space-y-2">
                  <input type="hidden" name="collabRequestId" value={req.id} />
                  <SubmitButton pendingLabel="Creating…" className="w-full sm:w-auto">Create deal</SubmitButton>
                  <p className="text-xs text-muted">Pre-filled from this request: contact, address, compensation, usage, menu/dietary/filming notes and deliverables. Claude is asked for a shot list.</p>
                </form>
              )}
            </Card>
          )}

          {req.status !== "spam" && (
            <Card title="Reply">
              {reply && (
                <p className="mb-3 flex flex-wrap items-center gap-2 text-sm">
                  Draft reply <StatusBadge status={reply.status} />
                  <Link href={`/review?draft=${reply.id}`} className="font-medium text-accent hover:underline">Open in Review →</Link>
                </p>
              )}
              <form action={askCollabReplyAction} className="space-y-2">
                <input type="hidden" name="id" value={req.id} />
                <label className="label" htmlFor="reply-note">Anything Claude should know? (optional)</label>
                <textarea id="reply-note" name="note" rows={2} maxLength={1000} className="input !min-h-0" placeholder="e.g. say yes, suggest a Tuesday visit" />
                <SubmitButton pendingLabel="Sending…" className="w-full sm:w-auto">Ask Claude to draft a reply</SubmitButton>
              </form>
              {contactDiffers && (
                <p className="mt-3 text-xs text-muted">
                  Claude’s draft goes to the lead’s saved email ({leadEmail ?? "none saved"}), not {req.email}. Copy the form’s contact onto the lead below if this person should get it.
                </p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <a href={`mailto:${req.email}`} className={buttonClass("ghost", "sm")}>Or email {req.email} yourself</a>
                <ReplyPicker context={{ name: firstName(req.contactName), business: req.businessName }} category="collab" label="Copy a saved reply" variant="ghost" size="sm" />
              </div>
            </Card>
          )}

          <Card title="Linked">
            <ul className="space-y-2 text-sm">
              <li className="flex items-center justify-between gap-2">
                <span className="text-muted">Lead</span>
                {lead ? (
                  <Link href={`/leads/${lead.id}`} className="font-medium text-accent hover:underline">{lead.name} · {STAGE_LABEL[lead.stage]}</Link>
                ) : (
                  <span className="text-muted">None</span>
                )}
              </li>
              {lead && contactDiffers && (
                <li>
                  <form action={copyCollabContactAction} className="flex flex-wrap items-center justify-between gap-2">
                    <input type="hidden" name="id" value={req.id} />
                    <span className="text-xs text-muted">Lead email: {leadEmail ?? "none"} · form: {req.email}</span>
                    <ConfirmButton variant="secondary" size="sm" confirm={`Replace the lead’s contact with ${req.contactName} <${req.email}>? Only do this if you trust this request came from the business.`}>
                      Use form contact on lead
                    </ConfirmButton>
                  </form>
                </li>
              )}
              <li className="flex items-center justify-between gap-2">
                <span className="text-muted">Ask for Nora</span>
                {req.askId ? <Link href={`/asks/${req.askId}`} className="font-medium text-accent hover:underline">Open ask</Link> : <span className="text-muted">None</span>}
              </li>
            </ul>
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
          <a key={i} href={p} target="_blank" rel="noreferrer nofollow" className="break-all text-accent hover:underline">{p}</a>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}
