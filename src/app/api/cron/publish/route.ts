import { publishDuePosts } from "@/lib/ops";
import { checkCronAuth } from "../auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Every 15 minutes: publish approved Instagram posts whose time has come. */
export async function GET(req: Request) {
  const denied = checkCronAuth(req);
  if (denied) return denied;
  const started = Date.now();
  try {
    const results = await publishDuePosts();
    return Response.json(
      { ok: results.every((r) => r.ok), published: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results, ms: Date.now() - started },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e), ms: Date.now() - started }, { status: 500 });
  }
}
