import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { ActionForm, SubmitButton } from "@/components/client-form";
import { LeadFields } from "@/components/lead-fields";
import { PageHeader } from "@/components/ui";
import { createLeadAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewLeadPage() {
  await requireUser();
  return (
    <>
      <PageHeader
        crumb={<Link href="/leads">Leads</Link>}
        title="Add a lead"
        subtitle="Just the name and city is enough; Claude can fill in the rest. If it’s already on the list, we’ll update it instead of adding a duplicate."
      />
      <ActionForm action={createLeadAction} className="max-w-2xl" ariaLabel="Add lead">
        <LeadFields idPrefix="new" />
        <div className="sticky-actions action-bar flex flex-wrap items-center gap-x-3 gap-y-2 mt-8">
          <SubmitButton pendingLabel="Adding…">Add lead</SubmitButton>
          <Link href="/leads" className="btn btn-ghost">Cancel</Link>
        </div>
      </ActionForm>
    </>
  );
}
