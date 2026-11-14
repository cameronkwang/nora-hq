import { runDailyReminders } from "@/lib/ops-notify";
import { errorText } from "@/lib/integrations/http";
import { checkCronAuth } from "../auth";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Daily phone reminders on their own (the hourly sync also runs them). Once per NY day after 8am;
 * `?force=1` sends now even if they already went out today (for testing).
 * `?preview=1` sends nothing: it returns the messages that would go out (title, body, link), so the wording can be
 * checked without a phone. `&at=<ISO date-time>` previews another moment (e.g. a Monday, for the weekly reels line).
 */
export async function GET(req: Request) {
  const denied = checkCronAuth(req);
  if (denied) return denied;
  const q = new URL(req.url).searchParams;
  const force = q.get("force") === "1";
  const preview = q.get("preview") === "1";
  const at = preview && q.get("at") ? new Date(q.get("at")!) : new Date();
  if (Number.isNaN(at.getTime())) return Response.json({ ok: false, error: "at must be an ISO date-time" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  try {
    const r = await runDailyReminders(at, { force, preview });
    return Response.json(r, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return Response.json({ ok: false, error: errorText(e) }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
