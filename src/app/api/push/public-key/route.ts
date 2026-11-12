import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { vapidPublicKey } from "@/lib/notify";

export const dynamic = "force-dynamic";

/** The VAPID public key the browser needs to subscribe (null until VAPID_* env vars are set). */
export async function GET() {
  if (!(await getUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ publicKey: vapidPublicKey() }, { headers: { "Cache-Control": "no-store" } });
}
