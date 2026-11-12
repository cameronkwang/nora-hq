import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { removePushSubscription } from "@/lib/ops-notify";
import { noStore, pushGuard, readJson } from "../guard";

export const dynamic = "force-dynamic";

/** POST { endpoint } — forgets this device (only if it's the signed-in person's). Idempotent. */
export async function POST(req: Request) {
  const g = await pushGuard(req);
  if ("error" in g) return g.error;
  const body = await readJson(req);
  const endpoint = typeof body?.endpoint === "string" ? body.endpoint : "";
  if (!endpoint) return NextResponse.json({ error: "bad_request" }, { status: 400, headers: noStore });
  const removed = await removePushSubscription(endpoint, g.user.email);
  revalidatePath("/settings/notifications");
  return NextResponse.json({ ok: true, removed }, { headers: noStore });
}
