import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listClients } from "@/lib/data";
import { ActionForm, SubmitButton } from "@/components/client-form";
import { CreatorFields } from "@/components/creator-fields";
import { ChannelSelect, CompSelect, StageSelect } from "@/components/outreach-fields";
import { Card, PageHeader, clientLabel } from "@/components/ui";
import { createCreatorAction } from "../actions";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function NewCreatorPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireUser();
  const sp = await searchParams;
  const clients = await listClients();
  const preselect = clients.some((c) => c.id === one(sp.client)) ? one(sp.client) : "";

  return (
    <>
      <PageHeader
        crumb={<Link href="/creators">Creators</Link>}
        title="Add creator"
        subtitle="If they're already in the roster (same handle or email), we'll update that profile instead of making a duplicate."
      />

      <ActionForm action={createCreatorAction} className="max-w-3xl [&>.sec:first-child]:mt-0" ariaLabel="Add creator">
        <Card title="Profile">
          <CreatorFields />
        </Card>

        <Card title="Start outreach (optional)">
          <p className="meta mb-4">Pick a business to add them to its pipeline now. Claude can then draft the first message for you to approve.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="label" htmlFor="new-client">Business</label>
              <select id="new-client" name="clientId" className="input" defaultValue={preselect}>
                <option value="">Don't start outreach yet</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{clientLabel(c)}</option>
                ))}
              </select>
            </div>
            <ChannelSelect idPrefix="new" />
            <CompSelect idPrefix="new" />
            <StageSelect idPrefix="new" stages={["sourced", "shortlisted"]} />
          </div>
          <p className="hint mt-4">
            Stage moves to “Contacted” automatically when a DM or email is marked sent from the review queue.
          </p>
        </Card>

        <div className="g-bar sticky-actions mt-8">
          <SubmitButton pendingLabel="Adding…">Add creator</SubmitButton>
          <Link href="/creators" className="btn btn-ghost">Cancel</Link>
        </div>
      </ActionForm>
    </>
  );
}
