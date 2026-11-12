import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { ActionForm, SubmitButton } from "@/components/client-form";
import { LeadFields } from "@/components/lead-fields";
import { Card, PageHeader } from "@/components/ui";
import { createLeadAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewLeadPage() {
  await requireUser();
  return (
    <>
      <p className="mb-2 text-sm">
        <Link href="/leads" className="text-muted hover:underline">← Leads</Link>
      </p>
      <PageHeader
        title="Add a lead"
        subtitle="Just the name and city is enough — Claude can fill in the rest. If it’s already on the list, we’ll update it instead of adding a duplicate."
      />
      <ActionForm action={createLeadAction} className="max-w-2xl space-y-4" ariaLabel="Add lead">
        <Card>
          <LeadFields idPrefix="new" />
        </Card>
        <div className="flex flex-wrap items-center gap-2">
          <SubmitButton pendingLabel="Adding…">Add lead</SubmitButton>
          <Link href="/leads" className="inline-flex min-h-11 items-center px-3 text-sm text-muted hover:underline">Cancel</Link>
        </div>
      </ActionForm>
    </>
  );
}
