import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { KitView } from "@/components/kit-view";
import { getPublicKit } from "@/lib/ops-kit";

/**
 * PUBLIC — Nora's media kit. No sign-in, no app chrome (outside the (app) group; middleware lists "/kit" as a
 * public page). 404s until Nora publishes it from /kit-settings. Numbers are live from My stats.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "Nora · Media kit" },
  description: "Food creator @noraeatsgood — audience, recent performance and how to work together.",
  robots: { index: false, follow: false },
  openGraph: { title: "Nora · Media kit", description: "Food creator @noraeatsgood — audience, recent performance and how to work together." },
};

export default async function KitPage() {
  const kit = await getPublicKit();
  if (!kit) notFound();
  return (
    <main className="min-h-dvh px-[max(1rem,env(safe-area-inset-left))] pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))] sm:pt-14">
      <KitView settings={kit.settings} stats={kit.stats} identity={kit.identity} />
    </main>
  );
}
