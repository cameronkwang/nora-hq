import { runFullSync, type StepResult } from "@/lib/integrations/sync";
import { syncCreatorInstagram } from "@/lib/integrations/creator-instagram";
import { syncCreatorTikTok } from "@/lib/integrations/tiktok";
import { errorText } from "@/lib/integrations/http";
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
  const steps = { ...summary.steps, creatorInstagram, creatorTikTok };
  return Response.json(
    { ...summary, ok: Object.values(steps).every((s) => s.ok), steps },
    { headers: { "Cache-Control": "no-store" } },
  );
}
