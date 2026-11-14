import { redirect } from "next/navigation";
import { forwardTo, type SP } from "../inbox/forward";

export const dynamic = "force-dynamic";

/** /insights forwards to Numbers, Reports, My stats or Google reviews (?tab=numbers|reports|stats|reviews). */
const TABS = { numbers: { path: "/numbers" }, reports: { path: "/reports" }, stats: { path: "/stats" }, reviews: { path: "/reviews" } };

export default async function InsightsPage({ searchParams }: { searchParams: Promise<SP> }) {
  redirect(forwardTo(await searchParams, TABS, "numbers"));
}
