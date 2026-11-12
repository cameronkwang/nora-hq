import { runFullSync, type StepResult } from "@/lib/integrations/sync";
import { syncCreatorInstagram } from "@/lib/integrations/creator-instagram";
import { syncCreatorTikTok } from "@/lib/integrations/tiktok";
import { errorText } from "@/lib/integrations/http";
import { runDailyReminders } from "@/lib/ops-notify";
import { monthlyReportKickoff } from "@/lib/ops-reports";
import { today } from "@/lib/dates";
import { checkCronAuth } from "../auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Each creator step is isolated: a failure (or a missing connection) never affects the rest. */
async function creatorStep(fn: () => Promise<{ ok: boolean; notConfigured?: boolean }>): Promise<StepResult> {
  const t = Date.now();
  try {
    const result = await fn();
    return { ok: result.ok || !!result.notConfigured, ms: Date.now() - t, result };
  } catch (e) {
    return { ok: false, ms: Date.now() - t, error: errorText(e) };
  }
}

/** Hourly (GitHub Actions) / daily (Vercel Cron): refresh tokens, pull reviews, views and email replies, then Nora's own stats. */
export async function GET(req: Request) {
  const denied = checkCronAuth(req);
  if (denied) return denied;
  const started = Date.now();
  const summary = await runFullSync();
  // TikTok is a few quick calls; Instagram's heavy parts stop at the deadline and catch up on the next run.
  const creatorTikTok = await creatorStep(() => syncCreatorTikTok());
  const creatorInstagram = await creatorStep(() => syncCreatorInstagram({ deadline: started + 55_000 }));
  // Phone reminders (payment overdue, tomorrow's visits): once a day, on the first run after 8am NY.
  const dailyReminders = await creatorStep(() => runDailyReminders());
  // Monthly client reports: on days 1–3 (NY) ask Claude to draft last month's internal + external reports. Idempotent.
  const monthlyReports = Number(today().slice(8, 10)) <= 3
    ? await creatorStep(async () => ({ ok: true, ...(await monthlyReportKickoff()) }))
    : undefined;
  const steps = { ...summary.steps, creatorInstagram, creatorTikTok, dailyReminders, ...(monthlyReports ? { monthlyReports } : {}) };
  return Response.json(
    { ...summary, ok: Object.values(steps).every((s) => s.ok), steps },
    { headers: { "Cache-Control": "no-store" } },
  );
}
