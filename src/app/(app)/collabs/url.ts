import "server-only";
import { headers } from "next/headers";

/** Public address of the collab form: APP_URL if set, else this request's own origin. */
export async function collabFormUrl(): Promise<string> {
  const env = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (env) return `${env}/collab`;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}/collab`;
}
