"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { createAsk } from "@/lib/ops";
import { clientLabel } from "@/components/ui";

const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.trim() : "");

function back(returnTo: string, msg: string, tone: "ok" | "warn" | "danger"): never {
  const u = new URL(returnTo.startsWith("/reviews") ? returnTo : "/reviews", "http://x");
  u.searchParams.set("msg", msg);
  u.searchParams.set("tone", tone);
  redirect(`${u.pathname}${u.search}`);
}

/** Files an ask for Claude to draft a reply; the draft then shows up in the review queue. */
export async function askClaudeToReplyAction(formData: FormData) {
  const user = await requireUser();
  const reviewId = str(formData.get("reviewId"));
  const returnTo = str(formData.get("returnTo")) || "/reviews";
  const db = await getDb();
  const [row] = await db
    .select({ r: schema.reviews, c: schema.clients })
    .from(schema.reviews)
    .innerJoin(schema.clients, eq(schema.clients.id, schema.reviews.clientId))
    .where(eq(schema.reviews.id, reviewId));
  if (!row) back(returnTo, "That review isn't here anymore — try syncing.", "danger");
  const { r, c } = row;
  const who = r.reviewer && r.reviewer !== "Anonymous" ? `${r.reviewer}'s` : "an anonymous";
  const stars = r.rating ? `${r.rating}-star` : "unrated";
  const note = str(formData.get("note"));
  const body = [
    `Draft a reply to ${who} ${stars} Google review for ${clientLabel(c)} (review id ${r.id}).`,
    note ? `Notes: ${note}` : null,
  ].filter(Boolean).join("\n");
  await createAsk({ clientId: c.id, body }, user.email);
  revalidatePath("/", "layout");
  back(returnTo, "Asked Claude for a draft. It'll show up in the review queue.", "ok");
}
