import "server-only";
import { addMonths, currentMonth, today } from "../dates";
import { errorText } from "./http";
import { refreshInstagramTokens, syncAllInstagramViews } from "./instagram";
import { syncGoogleReviews } from "./google";
import { checkOutreachReplies } from "./gmail";

/** Months whose Instagram views should be refreshed now: this month, plus last month during the 1st–3rd. */
export function viewMonths(now = new Date()): string[] {
  const m = currentMonth(now);
  const day = Number(today(now).slice(8, 10));
  return day <= 3 ? [addMonths(m, -1), m] : [m];
}

export type StepResult = { ok: boolean; ms: number; result?: unknown; error?: string };

async function step(fn: () => Promise<unknown>): Promise<StepResult> {
  const t = Date.now();
  try {
    const result = await fn();
    const ok = !(result && typeof result === "object" && "ok" in result && (result as { ok: unknown }).ok === false && !(result as { notConfigured?: boolean }).notConfigured);
    return { ok, ms: Date.now() - t, result };
  } catch (e) {
    return { ok: false, ms: Date.now() - t, error: errorText(e) };
  }
}

/** Everything the hourly/daily sync does. Each step is isolated so one failure doesn't stop the rest. */
export async function runFullSync(now = new Date()) {
  const instagramTokens = await step(() => refreshInstagramTokens());
  const googleReviews = await step(() => syncGoogleReviews());
  const months = viewMonths(now);
  const instagramViews = await step(() => syncAllInstagramViews(months));
  const gmailReplies = await step(() => checkOutreachReplies());
  const steps = { instagramTokens, googleReviews, instagramViews, gmailReplies };
  return { ok: Object.values(steps).every((s) => s.ok), at: now.toISOString(), months, steps };
}
