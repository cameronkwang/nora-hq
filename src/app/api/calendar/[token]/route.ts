import { calendarFor, verifyCalendarToken } from "@/lib/ops-notify";
import { appUrl } from "@/lib/integrations/oauth";
import { appendEvents } from "@/lib/ical";
import { today } from "@/lib/dates";
import { scheduleIcalEvents } from "@/lib/ops-schedule";

export const dynamic = "force-dynamic";

/**
 * Private calendar feed: GET /api/calendar/<token>.ics (public route — the token is the credential).
 * Unknown or revoked tokens get a plain 404 so the URL reveals nothing.
 */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const raw = decodeURIComponent(token).replace(/\.ics$/i, "");
  const hit = await verifyCalendarToken(raw);
  if (!hit) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store", "Content-Type": "text/plain" } });
  // Event links use APP_URL, or the address the calendar app fetched this from.
  const now = new Date();
  const origin = new URL(req.url).origin;
  let body = await calendarFor(hit.user.email, now, origin);
  // Nora's schedule: dated jobs as all-day events (same window as the rest of the feed). Never money.
  try {
    const base = appUrl() ?? origin.replace(/\/+$/, "");
    const shift = (n: number) => new Date(Date.parse(`${today(now)}T12:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
    body = appendEvents(body, await scheduleIcalEvents(shift(-30), shift(120), (path) => `${base}${path}`), now);
  } catch (e) {
    console.error("[calendar feed] schedule events skipped", e);
  }
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="nora-hq.ics"',
      "Cache-Control": "private, max-age=900",
      "X-Robots-Tag": "noindex",
    },
  });
}
