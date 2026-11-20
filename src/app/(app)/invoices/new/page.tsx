import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { requireUser } from "@/lib/auth";
import { OpsError } from "@/lib/ops";
import { getInvoice, getInvoiceCreatorContext, getInvoiceDone } from "@/lib/ops-invoices";
import { sameAsLastTime, sortPayWays, type ContractPart, type InvoiceCreatorContext, type InvoiceDone } from "@/lib/invoices-types";
import { InvoiceCreator, type CreatorEdit } from "@/components/invoice-creator";
import { PageHeader, Status } from "@/components/ui";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => ((Array.isArray(v) ? v[0] : v) ?? "").trim().slice(0, 80);
const PARTS: ContractPart[] = ["full", "deposit", "rest", "month"];

async function origin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/**
 * The fast creator (docs/invoicing.md "The fast creator"). Server-rendered from ONE call (getInvoiceCreatorContext,
 * whose reads run in parallel), so it opens filled in with no loading state; the screen itself is one small client
 * component. Pre-fills: ?customer= ?client= ?deal= ?contract= (&part=) ?draft=. ?done=<id> shows the done state again
 * (a reload after Make PDF). ?edit=<id> changes a finalized, unpaid invoice with the same screen.
 */
export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const doneId = one(sp.done);
  const editId = one(sp.edit);
  const part = one(sp.part) as ContractPart;
  const opts = {
    draftId: one(sp.draft) || null,
    contractId: one(sp.contract) || null,
    contractPart: PARTS.includes(part) ? part : null,
    dealId: one(sp.deal) || null,
    customerId: one(sp.customer) || null,
    clientId: one(sp.client) || null,
  };

  let ctx: InvoiceCreatorContext | null = null;
  let done: InvoiceDone | null = null;
  let edit: CreatorEdit | undefined;
  let error: string | null = null;
  try {
    if (doneId) {
      [ctx, done] = await Promise.all([getInvoiceCreatorContext({}), getInvoiceDone(doneId, user.email, { origin: await origin() })]);
    } else if (editId) {
      const [c, inv] = await Promise.all([getInvoiceCreatorContext({}), getInvoice(editId)]);
      if (!inv) notFound();
      if (inv.status === "draft") redirect(`/invoices/new?draft=${encodeURIComponent(inv.id)}`);
      if (inv.status === "paid" || inv.status === "void") redirect(`/invoices/${encodeURIComponent(inv.id)}`);
      edit = { id: inv.id, number: inv.number, customerName: inv.customer.name, customerAddress: inv.customer.billingAddress };
      ctx = {
        ...c,
        prefill: {
          ...c.prefill,
          billTo: null,
          newCustomer: null,
          // The exact lines (a typed-each-time line keeps its amount here: it's this invoice's).
          lines: sameAsLastTime(inv.items, c.savedItems).map((l, i) => ({ ...l, unitCents: inv.items[i]?.unitCents ?? l.unitCents })),
          issueDate: inv.issueDate ?? c.today,
          dueDate: inv.dueDate ?? inv.issueDate ?? c.today,
          payWays: sortPayWays(inv.payWays),
          payNote: inv.payNote,
          notes: inv.notes,
          lang: inv.lang,
          dealId: inv.dealId,
          contractId: inv.contractId,
          contractPart: null,
          draftId: null,
          source: "draft",
          note: null,
        },
      };
    } else {
      ctx = await getInvoiceCreatorContext(opts);
    }
  } catch (e) {
    if (!(e instanceof OpsError)) throw e;
    error = e.message;
  }

  const key = editId ? `edit:${editId}` : doneId ? `done:${doneId}` : JSON.stringify(opts);
  const title = edit ? `Edit ${edit.number ?? "invoice"}` : opts.draftId ? "Finish the draft" : "New invoice";

  return (
    <>
      <PageHeader
        crumb={<Link href="/invoices">Invoices</Link>}
        title={title}
      />
      {error || !ctx ? (
        <p role="status" className="notice">
          <Status tone="warn" className="is-wrap">{error ?? "The invoice creator isn't available."}</Status>
        </p>
      ) : (
        <InvoiceCreator key={key} ctx={ctx} edit={edit} initialDone={done} />
      )}
    </>
  );
}
