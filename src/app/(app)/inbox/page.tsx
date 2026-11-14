import { redirect } from "next/navigation";
import { forwardTo, type SP } from "./forward";

export const dynamic = "force-dynamic";

/** /inbox is a section, not a page: it forwards to its tab (/asks, /review), keeping any other query params. */
const TABS: Record<string, { path: string; tab?: string }> = {
  todo: { path: "/asks" },
  approve: { path: "/review" },
  ideas: { path: "/asks", tab: "ideas" },
  done: { path: "/asks", tab: "done" },
};

export default async function InboxPage({ searchParams }: { searchParams: Promise<SP> }) {
  redirect(forwardTo(await searchParams, TABS, "todo"));
}
