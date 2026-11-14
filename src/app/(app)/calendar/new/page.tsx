import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listClients } from "@/lib/data";
import { blobEnabled } from "@/lib/uploads";
import { CalendarPostForm } from "@/components/calendar-post-form";
import { PageHeader, clientLabel } from "@/components/ui";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function NewPostPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireUser();
  const sp = await searchParams;
  const clients = await listClients();
  const client = clients.some((c) => c.id === one(sp.client)) ? one(sp.client) : undefined;
  const platform = one(sp.platform) === "tiktok" ? "tiktok" : one(sp.platform) === "instagram" ? "instagram" : undefined;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(one(sp.date)) ? one(sp.date) : undefined;

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/calendar?tab=posts" className="mb-3 inline-block text-sm text-accent hover:underline">← Calendar</Link>
      <PageHeader title="New post" subtitle="Plan a post for the calendar. Claude can write the caption if you leave it blank — just drop an ask." />
      {clients.length === 0 ? (
        <p className="text-sm text-muted">
          Add a business first on the <Link href="/clients" className="text-accent hover:underline">businesses page</Link>.
        </p>
      ) : (
        <div className="rounded-xl border border-border bg-surface p-4 sm:p-6">
          <CalendarPostForm
            clients={clients.map((c) => ({ id: c.id, label: clientLabel(c) }))}
            defaults={{ clientId: client, platform, date }}
            directUpload={blobEnabled()}
          />
        </div>
      )}
    </div>
  );
}
