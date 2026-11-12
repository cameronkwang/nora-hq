import { calendarFor, verifyCalendarToken } from "@/lib/ops-notify";

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
  const body = await calendarFor(hit.user.email, new Date(), new URL(req.url).origin);
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
