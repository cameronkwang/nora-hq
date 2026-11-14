"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { listClients } from "@/lib/data";
import { deleteConnection, updateClient } from "@/lib/ops";
import { refreshInstagramTokens, syncAllInstagramViews, syncInstagramMonthlyViews } from "@/lib/integrations/instagram";
import { syncGoogleReviews } from "@/lib/integrations/google";
import { checkOutreachReplies } from "@/lib/integrations/gmail";
import { viewMonths } from "@/lib/integrations/sync";

type Tone = "ok" | "warn" | "danger";
const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.trim() : "");

function flash(msg: string, tone: Tone, path = "/settings"): never {
  const u = new URL(path, "http://x");
  u.searchParams.set("msg", msg.slice(0, 500));
  u.searchParams.set("tone", tone);
  redirect(`${u.pathname}${u.search}`);
}

function refresh() {
  revalidatePath("/", "layout");
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export async function syncReviewsAction(formData: FormData) {
  await requireUser();
  const back = str(formData.get("returnTo")) === "/reviews" ? "/reviews" : "/settings";
  const r = await syncGoogleReviews();
  refresh();
  if (r.notConfigured) flash(r.errors[0] ?? "Connect Google Business Profile first.", "warn", back);
  if (!r.ok) flash(r.errors.join(" · ") || "Review sync failed.", "danger", back);
  if (r.locations === 0) flash(r.errors[0] ?? "No locations to sync.", "warn", back);
  // A sync that "worked" can still leave a business with nothing: say which ones, per business.
  const notes: string[] = [];
  if (r.empty?.length) notes.push(`${r.empty.join(", ")}: 0 reviews came back — check it's the right Google listing.`);
  if (r.unlinked?.length) notes.push(`Not linked to a Google listing yet: ${r.unlinked.join(", ")}.`);
  flash([`Synced ${plural(r.synced, "review")} from ${plural(r.locations, "location")}.`, ...notes].join(" "), notes.length ? "warn" : "ok", back);
}

export async function syncInstagramViewsAction(formData: FormData) {
  await requireUser();
  const clientId = str(formData.get("clientId"));
  const months = viewMonths();
  if (clientId) {
    const errors: string[] = [];
    for (const m of months) {
      const r = await syncInstagramMonthlyViews(clientId, m);
      if (!r.ok && r.error) errors.push(r.error);
    }
    refresh();
    if (errors.length) flash(errors.join(" · "), "danger");
    flash("Instagram views updated.", "ok");
  }
  const r = await syncAllInstagramViews(months);
  refresh();
  if (r.errors.length) flash(`Updated ${plural(r.synced, "month")}. Problems: ${r.errors.join(" · ")}`, r.synced ? "warn" : "danger");
  if (r.synced === 0) flash("No connected Instagram accounts to sync yet.", "warn");
  flash(`Instagram views updated (${plural(r.synced, "business-month")}).`, "ok");
}

export async function refreshInstagramTokensAction() {
  await requireUser();
  const r = await refreshInstagramTokens();
  refresh();
  if (r.errors.length) flash(`Refreshed ${r.refreshed} of ${r.checked}. ${r.errors.join(" · ")}`, "warn");
  flash(r.refreshed ? `Renewed ${plural(r.refreshed, "Instagram token")}.` : "All Instagram tokens are fresh — nothing to renew.", "ok");
}

export async function checkRepliesAction() {
  await requireUser();
  const r = await checkOutreachReplies();
  refresh();
  if (r.notConfigured) flash("Connect the Gmail outreach inbox first.", "warn");
  if (!r.ok) flash(r.errors.join(" · ") || "Couldn't check Gmail.", "danger");
  const parts = [`Checked ${plural(r.checked, "thread")}`];
  if (r.replied) parts.push(`${r.replied} new ${r.replied === 1 ? "reply" : "replies"}`);
  if (r.optedOut) parts.push(`${r.optedOut} opted out (marked do-not-contact)`);
  flash(`${parts.join(", ")}.`, "ok");
}

export async function disconnectAction(formData: FormData) {
  const user = await requireUser();
  const id = str(formData.get("id"));
  if (!id) flash("Nothing to disconnect.", "warn");
  await deleteConnection(id, user.email);
  refresh();
  flash("Disconnected. Saved tokens were deleted.", "ok");
}

const LOCATION_RE = /^accounts\/[^/\s]+\/locations\/[^/\s]+$/;

export async function saveLocationsAction(formData: FormData) {
  const user = await requireUser();
  const clients = await listClients({ includeArchived: true });
  let changed = 0;
  const used = new Map<string, string>();
  for (const c of clients) {
    if (!formData.has(`loc_${c.id}`)) continue;
    const v = str(formData.get(`loc_${c.id}`)).replace(/^\/+|\/+$/g, "");
    if (v && !LOCATION_RE.test(v)) flash(`“${v}” isn't a Google location name. It should look like accounts/123/locations/456.`, "danger");
    if (v && used.has(v)) flash(`${c.name} and ${used.get(v)} can't share the same Google location.`, "danger");
    if (v) used.set(v, c.location ? `${c.name} (${c.location})` : c.name);
    if ((c.googleLocation ?? "") === v) continue;
    await updateClient(c.id, { googleLocation: v || null }, user.email);
    changed++;
  }
  refresh();
  flash(changed ? `Saved ${plural(changed, "location")}. Run “Sync reviews” to pull them in.` : "No changes.", changed ? "ok" : "warn");
}
