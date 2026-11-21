import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { requireUser } from "@/lib/auth";
import { OpsError } from "@/lib/ops";
import { getInvoiceCreatorContext, getInvoiceDone, getInvoiceEditContext } from "@/lib/ops-invoices";
import type { ContractPart, CreatorEdit, InvoiceCreatorContext, InvoiceDone } from "@/lib/invoices-types";
import { InvoiceCreator } from "@/components/invoice-creator";
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
 * component. Pre-fills: ?customer= ?client= ?deal= ?contract= (&part=) ?draft=. ?done=<id> (added to the address
 * after Make PDF) shows the done state again on a reload. ?edit=<id> changes a finalized, unpaid invoice with the same
 * screen.
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
      // The invoice as the creator's prefill, with everything the form can change (ops: getInvoiceEditContext).
      const e = await getInvoiceEditContext(editId);
      if (!e) notFound();
      if (e.status === "draft") redirect(`/invoices/new?draft=${encodeURIComponent(e.edit.id)}`);
      if (e.status === "paid" || e.status === "void") redirect(`/invoices/${encodeURIComponent(e.edit.id)}`);
      edit = e.edit;
      ctx = e.ctx;
    } else {
      ctx = await getInvoiceCreatorContext(opts);
    }
  } catch (e) {
    if (!(e instanceof OpsError)) throw e;
    error = e.message;
  }

  // ?done= is NOT part of the key: after Make PDF the creator adds it to the address it already has, so the live
  // refresh renders the same key and the done state is never remounted (Share stays ready, the language stays chosen).
  const key = editId ? `edit:${editId}` : JSON.stringify(opts);
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
