import Link from "next/link";
import { headers } from "next/headers";
import { requireUser } from "@/lib/auth";
import { CREATOR_CLIENT_ID } from "@/lib/data";
import { getKitIdentity, getKitStats, getMediaKitSettings, pastCollabCandidates } from "@/lib/ops-kit";
import { PageHeader } from "@/components/ui";
import { KitSettingsForm } from "@/components/kit-settings-form";
import { saveKitAction } from "./actions";

/**
 * Manage Nora's public media kit. No nav item: reached from Nora's workspace (and My stats).
 * Numbers are read-only here — they come from My stats.
 */

export const dynamic = "force-dynamic";
export const metadata = { title: "Media kit" };

export default async function KitSettingsPage() {
  await requireUser();
  const [settings, stats, identity, candidates, h] = await Promise.all([getMediaKitSettings(), getKitStats(), getKitIdentity(), pastCollabCandidates(), headers()]);
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const kitUrl = host ? `${proto}://${host}/kit` : "/kit";
  const { updatedAt: _u, updatedBy: _b, ...initial } = settings;

  return (
    <>
      <PageHeader
        title={
          <>
            <Link href={`/clients/${CREATOR_CLIENT_ID}`} className="hover:underline">{identity.name}</Link>
            <span className="text-muted"> · Media kit</span>
          </>
        }
        subtitle={
          <>
            A public page for businesses: your numbers, style and rates. Numbers update on their own from{" "}
            <Link href="/stats" className="text-accent hover:underline">My stats</Link>.
          </>
        }
      />
      <KitSettingsForm action={saveKitAction} initial={initial} stats={stats} identity={identity} candidates={candidates} kitUrl={kitUrl} />
    </>
  );
}
