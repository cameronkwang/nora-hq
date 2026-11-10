import { runFullSync } from "@/lib/integrations/sync";
import { checkCronAuth } from "../auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Hourly (GitHub Actions) / daily (Vercel Cron): refresh tokens, pull reviews, views and email replies. */
export async function GET(req: Request) {
  const denied = checkCronAuth(req);
  if (denied) return denied;
  const summary = await runFullSync();
  return Response.json(summary, { headers: { "Cache-Control": "no-store" } });
}
