import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { OpsError } from "@/lib/ops";
import { savePushSubscription } from "@/lib/ops-notify";
import { noStore, pushGuard, readJson } from "../guard";

export const dynamic = "force-dynamic";

/** POST { subscription: PushSubscriptionJSON } — saves this device for the signed-in person. */
export async function POST(req: Request) {
  const g = await pushGuard(req);
  if ("error" in g) return g.error;
  const body = await readJson(req);
  if (!body) return NextResponse.json({ error: "bad_request" }, { status: 400, headers: noStore });
  try {
    const r = await savePushSubscription(body.subscription, g.user.email, req.headers.get("user-agent"));
    revalidatePath("/settings/notifications");
    return NextResponse.json({ ok: true, id: r.id }, { headers: noStore });
  } catch (e) {
    if (e instanceof ZodError) return NextResponse.json({ error: "invalid_subscription" }, { status: 400, headers: noStore });
    if (e instanceof OpsError) return NextResponse.json({ error: e.message }, { status: 403, headers: noStore });
    throw e;
  }
}
