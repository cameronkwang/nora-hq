import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { formatDate, monthLabel, today } from "@/lib/dates";
import { DELIVERABLE_LABEL, PAYMENT_DUE_DAYS, addDays, dateToZonedLocal, getDeal, isOverdue } from "@/lib/ops-deals";
import { getKitIdentity } from "@/lib/ops-kit";
import { getPaymentLine } from "@/lib/ops-payment";
import { scheduleItemForDeal } from "@/lib/ops-schedule";
import { buildPaymentRequest } from "@/lib/payment-request";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/client-form";
import {
  COMP_LABEL, DEAL_STATUS_LABEL, DealStatusBadge, PaymentChip, centsToDollarsInput, compText, formatMoney, formatVisit,
} from "@/components/deal-bits";
import { DealShotList } from "@/components/deal-shot-list";
import { PaymentRequest } from "@/components/payment-request";
import { Card, LinkButton, PageHeader, buttonClass, cx } from "@/components/ui";
import {
  addDeliverableAction, askShotListAction, deleteDealAction, deleteDeliverableAction, saveDealAction, saveDeliverableAction,
  setDealStatusAction, setDealStatusToAction, setPaymentAction, setPaymentToAction,
} from "../actions";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

const STATUS_FLOW: schema.DealStatus[] = ["planning", "scheduled", "shot", "posted", "complete"];

export default async function DealPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  await requireUser();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const deal = await getDeal(id);
  if (!deal) notFound();
  const db = await getDb();
  const [lead, client, paymentLine, identity, scheduleItem] = await Promise.all([
    deal.leadId ? db.select({ id: schema.leads.id, name: schema.leads.name }).from(schema.leads).where(eq(schema.leads.id, deal.leadId)).then((r) => r[0] ?? null) : null,
    deal.clientId ? db.select({ id: schema.clients.id, name: schema.clients.name }).from(schema.clients).where(eq(schema.clients.id, deal.clientId)).then((r) => r[0] ?? null) : null,
    getPaymentLine(),
    getKitIdentity(),
    scheduleItemForDeal(deal.id),
  ]);
  const t = today();
  const error = one(sp.error);
  const flash = one(sp.new)
    ? "Deal created. Claude has been asked for a shot list — it shows up below once it’s written."
    : one(sp.from) === "schedule"
      ? `Deal made from Nora’s schedule. Add the fee here — the schedule only ever shows Paid or Not paid.${deal.visitAt ? " The visit is set to noon on that day; change the time below if you know it." : ""}`
    : one(sp.asked) ? "Asked Claude for a shot list." : "";
  const paidComp = deal.compType !== "gifted";
  const posted = deal.deliverables.filter((d) => d.postedAt).length;
  const back = `/deals/${deal.id}`;
  // "Request payment": template text (no AI) from what's on this deal. Nothing is sent from here.
  const request = buildPaymentRequest({
    businessName: deal.businessName,
    contactName: deal.contactName,
    amountCents: deal.amountCents,
    deliverables: deal.deliverables.map((d) => ({ label: DELIVERABLE_LABEL[d.kind], postUrl: d.postUrl, postedOn: d.postedAt ? today(d.postedAt) : null, dueDate: d.dueDate })),
    visitDate: deal.visitAt ? today(deal.visitAt) : null,
    dueDate: deal.paymentDueDate ?? addDays(t, PAYMENT_DUE_DAYS),
    paymentLine,
    fromName: identity.name,
    fromHandle: identity.igHandle,
    today: t,
  });

  return (
    <>
      <p className="mb-2 text-sm">
        <Link href="/deals" className="text-muted hover:underline">← Collab deals</Link>
      </p>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-2">{deal.businessName}<DealStatusBadge status={deal.status} /></span>}
        subtitle={[deal.visitAt ? formatVisit(deal.visitAt) : "No visit date yet", compText(deal)].filter(Boolean).join(" · ")}
        actions={<LinkButton href={`/deals/${deal.id}/visit`} variant="primary">Visit mode</LinkButton>}
      />

      {flash && <p role="status" className="mb-4 rounded-lg bg-ok-soft px-3 py-2 text-sm text-ok">{flash}</p>}
      {error && <p role="alert" className="mb-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-5">
          {/* Terms & visit */}
          <Card title="Terms & visit">
            <ActionForm action={saveDealAction} className="grid gap-4">
              <input type="hidden" name="id" value={deal.id} />
              <Field label="Business name" htmlFor="businessName">
                <input id="businessName" name="businessName" required maxLength={160} defaultValue={deal.businessName} className="input" />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Compensation" htmlFor="compType">
                  <select id="compType" name="compType" defaultValue={deal.compType} className="input">
                    {schema.DEAL_COMP.map((c) => <option key={c} value={c}>{COMP_LABEL[c]}</option>)}
                  </select>
                </Field>
                <Field label="Agreed fee ($)" htmlFor="amount" hint="Media kit rates start at $600 — custom rates are fine.">
                  <input id="amount" name="amount" inputMode="decimal" defaultValue={centsToDollarsInput(deal.amountCents)} placeholder="600" className="input" autoComplete="off" />
                </Field>
              </div>
              <Field label="Visit (New York time)" htmlFor="visitAt">
                <input id="visitAt" name="visitAt" type="datetime-local" defaultValue={dateToZonedLocal(deal.visitAt)} className="input" />
              </Field>
              <Field label="Usage rights" htmlFor="usageRights" hint="Organic only / repost on their channels / paid ads (priced separately).">
                <input id="usageRights" name="usageRights" maxLength={300} defaultValue={deal.usageRights ?? ""} className="input" />
              </Field>
              <Field label="Terms" htmlFor="terms">
                <textarea id="terms" name="terms" rows={3} maxLength={4000} defaultValue={deal.terms ?? ""} className="input" placeholder="What was agreed: deliverables, timing, exclusivity, payment terms…" />
              </Field>

              <fieldset className="grid gap-4 sm:grid-cols-3">
                <legend className="label mb-2">Contact</legend>
                <input aria-label="Contact name" name="contactName" maxLength={120} defaultValue={deal.contactName ?? ""} placeholder="Name" className="input" autoComplete="off" />
                <input aria-label="Contact email" name="contactEmail" type="email" maxLength={200} defaultValue={deal.contactEmail ?? ""} placeholder="Email" className="input" autoComplete="off" />
                <input aria-label="Contact phone" name="contactPhone" type="tel" maxLength={40} defaultValue={deal.contactPhone ?? ""} placeholder="Phone" className="input" autoComplete="off" />
              </fieldset>
              <Field label="Address" htmlFor="address">
                <input id="address" name="address" maxLength={300} defaultValue={deal.address ?? ""} className="input" placeholder="Street, city" autoComplete="off" />
              </Field>
              <Field label="Order / signature dishes" htmlFor="menuNotes">
                <textarea id="menuNotes" name="menuNotes" rows={3} maxLength={3000} defaultValue={deal.menuNotes ?? ""} className="input" />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Dietary notes" htmlFor="dietaryNotes">
                  <textarea id="dietaryNotes" name="dietaryNotes" rows={2} maxLength={2000} defaultValue={deal.dietaryNotes ?? ""} className="input !min-h-0" />
                </Field>
                <Field label="Filming notes" htmlFor="filmingNotes">
                  <textarea id="filmingNotes" name="filmingNotes" rows={2} maxLength={2000} defaultValue={deal.filmingNotes ?? ""} className="input !min-h-0" placeholder="Best times, restrictions, lighting…" />
                </Field>
              </div>
              <Field label="Notes" htmlFor="notes">
                <textarea id="notes" name="notes" rows={2} maxLength={5000} defaultValue={deal.notes ?? ""} className="input !min-h-0" />
              </Field>
              <div className="sticky-actions -mx-1 flex justify-end rounded-lg bg-surface/90 p-1 backdrop-blur">
                <SubmitButton className="w-full sm:w-auto">Save</SubmitButton>
              </div>
            </ActionForm>
          </Card>

          {/* Deliverables */}
          <Card title={<>Deliverables{deal.deliverables.length > 0 && <span className="font-normal text-muted"> · {posted}/{deal.deliverables.length} posted</span>}</>} padded={false}>
            {deal.deliverables.length > 0 && (
              <ul className="divide-y divide-border">
                {deal.deliverables.map((d) => {
                  const late = !d.postedAt && !!d.dueDate && d.dueDate < t;
                  return (
                    <li key={d.id} className="p-4">
                      <form action={saveDeliverableAction} className="grid gap-3">
                        <input type="hidden" name="id" value={d.id} />
                        <input type="hidden" name="dealId" value={deal.id} />
                        <div className="flex flex-wrap items-center gap-2">
                          <select name="kind" defaultValue={d.kind} aria-label="Type" className="input w-auto font-medium">
                            {schema.DELIVERABLE_KINDS.map((k) => <option key={k} value={k}>{DELIVERABLE_LABEL[k]}</option>)}
                          </select>
                          {d.postedAt ? (
                            <span className="text-xs font-medium text-ok">Posted {formatDate(d.postedAt)}</span>
                          ) : late ? (
                            <span className="text-xs font-semibold text-danger">Late — was due {formatDate(d.dueDate)}</span>
                          ) : null}
                        </div>
                        <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
                          <div>
                            <label className="label" htmlFor={`due-${d.id}`}>Due</label>
                            <input id={`due-${d.id}`} name="dueDate" type="date" defaultValue={d.dueDate ?? ""} className="input" />
                          </div>
                          <div>
                            <label className="label" htmlFor={`url-${d.id}`}>Post link</label>
                            <input id={`url-${d.id}`} name="postUrl" type="url" inputMode="url" maxLength={500} defaultValue={d.postUrl ?? ""} placeholder="https://www.instagram.com/reel/…" className="input" />
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                          <label className="flex min-h-11 items-center gap-2 text-sm md:min-h-0">
                            <input type="checkbox" name="posted" defaultChecked={!!d.postedAt} /> Posted
                          </label>
                          <label className="flex min-h-11 items-center gap-2 text-sm md:min-h-0">
                            <input type="checkbox" name="disclosureOk" defaultChecked={!!d.disclosureOk} /> Disclosed (#ad / Paid partnership / gifted)
                          </label>
                          <span className="ml-auto flex gap-2">
                            <ConfirmButton variant="ghost" size="sm" confirm="Remove this deliverable?" formAction={deleteDeliverableAction}>Remove</ConfirmButton>
                            <SubmitButton size="sm" variant="secondary">Save</SubmitButton>
                          </span>
                        </div>
                      </form>
                    </li>
                  );
                })}
              </ul>
            )}
            <form action={addDeliverableAction} className={cx("flex flex-wrap items-end gap-2 p-4", deal.deliverables.length > 0 && "border-t border-border")}>
              <input type="hidden" name="dealId" value={deal.id} />
              <div>
                <label className="label" htmlFor="new-kind">Add</label>
                <select id="new-kind" name="kind" className="input w-auto" defaultValue="ig_reel">
                  {schema.DELIVERABLE_KINDS.map((k) => <option key={k} value={k}>{DELIVERABLE_LABEL[k]}</option>)}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="new-due">Due</label>
                <input id="new-due" name="dueDate" type="date" className="input" />
              </div>
              <SubmitButton variant="secondary" pendingLabel="Adding…">Add deliverable</SubmitButton>
            </form>
          </Card>

          {/* Shot list */}
          <Card title="Shot list">
            <DealShotList dealId={deal.id} shots={deal.shotList} editable />
            <form action={askShotListAction} className="mt-4 flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-end">
              <input type="hidden" name="id" value={deal.id} />
              <div className="min-w-0 flex-1">
                <label className="label" htmlFor="shot-note">{deal.shotList.length ? "Ask Claude to rewrite it (keeps your ticks)" : "Ask Claude for a shot list"}</label>
                <input id="shot-note" name="note" maxLength={1000} className="input" placeholder="Optional, e.g. focus on the new brunch menu" autoComplete="off" />
              </div>
              <SubmitButton variant="secondary" pendingLabel="Asking…">Ask Claude</SubmitButton>
            </form>
          </Card>
        </div>

        <aside className="space-y-5">
          <Card title="Status">
            <form action={setDealStatusAction} className="flex flex-wrap gap-2">
              <input type="hidden" name="id" value={deal.id} />
              <input type="hidden" name="back" value={back} />
              {STATUS_FLOW.map((s) => (
                <button key={s} formAction={setDealStatusToAction.bind(null, s)} aria-pressed={deal.status === s}
                  className={cx(buttonClass(deal.status === s ? "primary" : "secondary", "sm"))}>
                  {DEAL_STATUS_LABEL[s]}
                </button>
              ))}
            </form>
            <form action={setDealStatusAction} className="mt-3">
              <input type="hidden" name="id" value={deal.id} />
              <input type="hidden" name="back" value={back} />
              <input type="hidden" name="status" value={deal.status === "cancelled" ? "planning" : "cancelled"} />
              <SubmitButton variant="ghost" size="sm">{deal.status === "cancelled" ? "Reopen deal" : "Cancel deal"}</SubmitButton>
            </form>
            <p className="mt-2 text-xs text-muted">Moves to Posted by itself once every deliverable is posted.</p>
          </Card>

          <Card title="Payment" actions={<PaymentChip deal={deal} today={t} />}>
            {!paidComp && deal.paymentStatus !== "paid" ? (
              <p className="text-sm text-muted">Gifted — nothing to invoice. Change the compensation in Terms if that changes.</p>
            ) : (
              <>
                <p className="text-sm">
                  {deal.amountCents != null ? <span className="text-lg font-semibold tabular-nums">{formatMoney(deal.amountCents)}</span> : <span className="text-muted">No fee set yet.</span>}
                  {deal.paymentStatus === "paid" && deal.paidAt && <span className="ml-2 text-muted">paid {formatDate(deal.paidAt)}</span>}
                  {deal.paymentStatus === "requested" && deal.paymentDueDate && (
                    <span className={cx("ml-2", isOverdue(deal, t) ? "font-semibold text-danger" : "text-muted")}>due {formatDate(deal.paymentDueDate)}</span>
                  )}
                </p>
                <form action={setPaymentAction} className="mt-3 grid gap-3">
                  <input type="hidden" name="id" value={deal.id} />
                  <input type="hidden" name="back" value={back} />
                  {deal.paymentStatus !== "paid" && (
                    <div>
                      <label className="label" htmlFor="dueDate">Due date</label>
                      <input id="dueDate" name="dueDate" type="date" className="input"
                        defaultValue={deal.paymentDueDate ?? addDays(t, PAYMENT_DUE_DAYS)} />
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {deal.paymentStatus !== "requested" && deal.paymentStatus !== "paid" && (
                      <button formAction={setPaymentToAction.bind(null, "requested")} className={buttonClass("secondary")}>Invoice sent</button>
                    )}
                    {deal.paymentStatus === "requested" && (
                      <button formAction={setPaymentToAction.bind(null, "requested")} className={buttonClass("secondary")}>Update due date</button>
                    )}
                    {deal.paymentStatus !== "paid" ? (
                      <button formAction={setPaymentToAction.bind(null, "paid")} className={buttonClass("primary")}>Mark paid</button>
                    ) : (
                      <button formAction={setPaymentToAction.bind(null, "requested")} className={buttonClass("ghost", "sm")}>Not paid after all</button>
                    )}
                    {deal.paymentStatus === "requested" && (
                      <button formAction={setPaymentToAction.bind(null, "not_requested")} className={buttonClass("ghost", "sm")}>Not invoiced yet</button>
                    )}
                  </div>
                </form>
                <p className="mt-2 text-xs text-muted">Only you can change this — Claude never marks anything paid.</p>
                {deal.paymentStatus !== "paid" && deal.status !== "cancelled" && (
                  <PaymentRequest
                    invoice={request.invoice}
                    reminder={request.reminder}
                    missing={request.missing}
                    to={deal.contactEmail}
                    paymentLine={paymentLine}
                    invoiced={deal.paymentStatus === "requested"}
                  />
                )}
              </>
            )}
          </Card>

          <Card title="Linked">
            <ul className="space-y-2 text-sm">
              <LinkedRow label="Collab request" href={deal.collabRequestId ? `/collabs/${deal.collabRequestId}` : null} text="Open request" />
              <LinkedRow label="Lead" href={lead ? `/leads/${lead.id}` : null} text={lead?.name ?? ""} />
              <LinkedRow label="Business" href={client ? `/clients/${client.id}` : null} text={client?.name ?? ""} />
              {scheduleItem && (
                <LinkedRow label="Nora’s schedule" href={`/calendar?month=${scheduleItem.month}`} text={scheduleItem.date ? formatDate(scheduleItem.date) : monthLabel(scheduleItem.month)} />
              )}
            </ul>
          </Card>

          <form action={deleteDealAction}>
            <input type="hidden" name="id" value={deal.id} />
            <ConfirmButton confirm={`Delete the ${deal.businessName} deal? Its deliverables and shot list go too. This can’t be undone.`}>Delete deal</ConfirmButton>
          </form>
        </aside>
      </div>
    </>
  );
}

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

function LinkedRow({ label, href, text }: { label: string; href: string | null; text: string }) {
  return (
    <li className="flex min-h-11 items-center justify-between gap-2 md:min-h-0">
      <span className="text-muted">{label}</span>
      {href ? <Link href={href} className="truncate font-medium text-accent hover:underline">{text}</Link> : <span className="text-muted">None</span>}
    </li>
  );
}
