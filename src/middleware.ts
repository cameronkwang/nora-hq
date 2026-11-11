import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

// Routes that authenticate themselves (bearer tokens / cron secret) or are public.
const PUBLIC_PREFIXES = ["/login", "/api/mcp", "/api/cron", "/api/asks/capture", "/_next", "/favicon", "/manifest", "/icon"];
/** Public pages matched by whole path segment, so "/collab" is public but "/collabs" (Nora's inbox) is not. */
const PUBLIC_PAGES = ["/collab"];
const isPublicPage = (pathname: string) => PUBLIC_PAGES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p)) || isPublicPage(pathname)) return NextResponse.next();
  const user = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (user) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };
