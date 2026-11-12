import { NextResponse } from "next/server";
import { sendTest } from "@/lib/notify";
import { noStore, pushGuard } from "../guard";

export const dynamic = "force-dynamic";

/** POST — sends a test notification to all of the signed-in person's devices. */
export async function POST(req: Request) {
  const g = await pushGuard(req);
  if ("error" in g) return g.error;
  const r = await sendTest(g.user.email);
  return NextResponse.json({ ok: r.sent > 0, ...r }, { headers: noStore });
}
