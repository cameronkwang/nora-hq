import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";

/** Vercel Cron (and the GitHub Actions workflow) send "Authorization: Bearer <CRON_SECRET>". */
export function checkCronAuth(req: Request): Response | null {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) return Response.json({ error: "not_configured", message: "Set CRON_SECRET to enable scheduled jobs." }, { status: 503 });
  const m = /^Bearer\s+(.+)$/i.exec((req.headers.get("authorization") ?? "").trim());
  const ok = !!m && timingSafeEqual(createHash("sha256").update(m[1].trim()).digest(), createHash("sha256").update(expected).digest());
  return ok ? null : Response.json({ error: "unauthorized" }, { status: 401 });
}
