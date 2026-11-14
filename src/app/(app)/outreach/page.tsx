import { redirect } from "next/navigation";
import { forwardTo, type SP } from "../inbox/forward";

export const dynamic = "force-dynamic";

/** /outreach forwards to Creators, Leads or Collab requests (?tab=creators|leads|collabs). */
const TABS = { creators: { path: "/creators" }, leads: { path: "/leads" }, collabs: { path: "/collabs" } };

export default async function OutreachPage({ searchParams }: { searchParams: Promise<SP> }) {
  redirect(forwardTo(await searchParams, TABS, "creators"));
}
