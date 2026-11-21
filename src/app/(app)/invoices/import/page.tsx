import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { InvoiceImport } from "@/components/invoice-import";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

/** Import from Skynova (docs/invoicing.md "Import from Skynova"): paste, preview, then save. */
export default async function InvoiceImportPage() {
  await requireUser();
  return (
    <>
      <PageHeader
        crumb={<Link href="/invoices">Invoices</Link>}
        title="Import from Skynova"
        subtitle="Copy the table from Skynova's Customers or Invoices page and paste it here. Nothing is saved until you check the preview."
      />
      <InvoiceImport />
    </>
  );
}
