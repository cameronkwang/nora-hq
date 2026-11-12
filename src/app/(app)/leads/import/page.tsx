import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { LeadImport } from "@/components/lead-import";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ImportLeadsPage() {
  await requireUser();
  return (
    <>
      <p className="mb-2 text-sm">
        <Link href="/leads" className="text-muted hover:underline">← Leads</Link>
      </p>
      <PageHeader
        title="Import leads"
        subtitle="Paste from Google Sheets or upload a CSV. You’ll see what’s new and what updates an existing lead before anything is saved."
      />
      <LeadImport />
    </>
  );
}
