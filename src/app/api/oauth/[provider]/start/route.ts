import { NextResponse, type NextRequest } from "next/server";
import { getUser } from "@/lib/auth";
import { getClient } from "@/lib/data";
import { STATE_COOKIE, STATE_MAX_AGE, appUrl, createState, isOAuthProvider, redirectUri } from "@/lib/integrations/oauth";
import { instagramAuthorizeUrl, instagramConfigured } from "@/lib/integrations/instagram";
import { googleAuthorizeUrl, googleOAuthConfigured } from "@/lib/integrations/google-auth";
import { GOOGLE_BUSINESS_SCOPES } from "@/lib/integrations/google";
import { GMAIL_SCOPES } from "@/lib/integrations/gmail";
import { createCreatorState, creatorInstagramAuthorizeUrl, type CreatorOAuthProvider } from "@/lib/integrations/creator-instagram";
import { tiktokAuthorizeUrl, tiktokConfigured } from "@/lib/integrations/tiktok";

export const dynamic = "force-dynamic";

function back(req: NextRequest, error: string) {
  const u = new URL("/settings", req.url);
  u.searchParams.set("error", error);
  return NextResponse.redirect(u);
}

function stateCookie(res: NextResponse, nonce: string) {
  res.cookies.set(STATE_COOKIE, nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/oauth",
    maxAge: STATE_MAX_AGE,
  });
  res.headers.set("Cache-Control", "no-store");
  return res;
}

/** Nora's own accounts (@noraeatsgood): /api/oauth/instagram/start?purpose=creator and /api/oauth/tiktok/start. */
async function startCreator(req: NextRequest, provider: CreatorOAuthProvider, userEmail: string) {
  const back = (error: string) => {
    const u = new URL("/stats", req.url);
    u.searchParams.set("error", error);
    return NextResponse.redirect(u);
  };
  if (provider === "instagram" && !instagramConfigured()) return back("Instagram isn't set up yet: add IG_APP_ID and IG_APP_SECRET (docs/setup.md, step 5).");
  if (provider === "tiktok" && !tiktokConfigured()) return back("TikTok isn't set up yet: add TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET (docs/setup.md, “Nora's own stats”).");
  const base = appUrl(req.nextUrl.origin);
  if (!base) return back("Set APP_URL so the sign-in can return here.");
  const redirect = `${base}/api/oauth/${provider}/callback`;
  let state: string, nonce: string;
  try {
    ({ state, nonce } = await createCreatorState({ provider, user: userEmail }));
  } catch {
    return back("AUTH_SECRET is not set.");
  }
  const url = provider === "instagram" ? creatorInstagramAuthorizeUrl(state, redirect) : tiktokAuthorizeUrl(state, redirect);
  return stateCookie(NextResponse.redirect(url), nonce);
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const user = await getUser();
  const { provider } = await params;
  const creator = provider === "tiktok" || (provider === "instagram" && req.nextUrl.searchParams.get("purpose") === "creator");
  if (!user) return NextResponse.redirect(new URL(`/login?next=${creator ? "/stats" : "/settings"}`, req.url));
  if (creator) return startCreator(req, provider as CreatorOAuthProvider, user.email);
  if (!isOAuthProvider(provider)) return back(req, "Unknown connection type.");

  const ok = provider === "instagram" ? instagramConfigured() : googleOAuthConfigured();
  if (!ok) {
    return back(req, provider === "instagram"
      ? "Instagram isn't set up yet: add IG_APP_ID and IG_APP_SECRET (docs/setup.md, step 5)."
      : "Google isn't set up yet: add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (docs/setup.md, step 6).");
  }
  const redirect = redirectUri(provider, req.nextUrl.origin);
  if (!redirect) return back(req, "Set APP_URL so the sign-in can return here.");

  let clientId: string | null = null;
  if (provider === "instagram") {
    clientId = req.nextUrl.searchParams.get("client");
    if (!clientId || !(await getClient(clientId))) return back(req, "Pick which business this Instagram account belongs to.");
  }

  let state: string, nonce: string;
  try {
    ({ state, nonce } = await createState({ provider, clientId, user: user.email }));
  } catch {
    return back(req, "AUTH_SECRET is not set.");
  }

  const url = provider === "instagram"
    ? instagramAuthorizeUrl(state, redirect)
    : googleAuthorizeUrl(provider === "google" ? GOOGLE_BUSINESS_SCOPES : GMAIL_SCOPES, state, redirect);

  return stateCookie(NextResponse.redirect(url), nonce);
}
