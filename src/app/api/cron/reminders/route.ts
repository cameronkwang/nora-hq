import { runDailyReminders } from "@/lib/ops-notify";
import { errorText } from "@/lib/integrations/http";
import { checkCronAuth } from "../auth";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Daily phone reminders on their own (the hourly sync also runs them). Once per NY day after 8am;
 * `?force=1` sends now even if they already went out today (for testing).
 */
export async function GET(req: Request) {
  const denied = checkCronAuth(req);
  if (denied) return denied;
  const force = new URL(req.url).searchParams.get("force") === "1";
  try {
    const r = await runDailyReminders(new Date(), { force });
    return Response.json(r, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return Response.json({ ok: false, error: errorText(e) }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
