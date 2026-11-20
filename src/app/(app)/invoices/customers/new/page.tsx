import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { ActionForm, SubmitButton } from "@/components/client-form";
import { CustomerFields } from "@/components/invoice-customer-fields";
import { PageHeader } from "@/components/ui";
import { createCustomerAction } from "../../actions";

export const dynamic = "force-dynamic";

/** A customer by hand (most are made inline by the creator, from a business, a deal, a contract or the import). */
export default async function NewCustomerPage() {
  await requireUser();
  return (
    <>
      <PageHeader crumb={<Link href="/invoices/customers">Customers</Link>} title="New customer" subtitle="Usually you don't need this: typing a new name in New invoice makes the customer too." />
      <ActionForm action={createCustomerAction} className="grid max-w-xl gap-4">
        <CustomerFields />
        <div>
          <SubmitButton variant="primary" pendingLabel="Saving…">Save customer</SubmitButton>
        </div>
      </ActionForm>
    </>
  );
}
