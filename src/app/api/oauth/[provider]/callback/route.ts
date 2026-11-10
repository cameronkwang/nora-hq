import { NextResponse, type NextRequest } from "next/server";
import { getUser } from "@/lib/auth";
import { saveConnection } from "@/lib/ops";
import { PROVIDER_LABEL, STATE_COOKIE, isOAuthProvider, redirectUri, verifyState } from "@/lib/integrations/oauth";
import { exchangeInstagramCode } from "@/lib/integrations/instagram";
import { exchangeGoogleCode } from "@/lib/integrations/google-auth";
import { gmailProfile } from "@/lib/integrations/gmail";
import { errorText } from "@/lib/integrations/http";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function done(req: NextRequest, params: Record<string, string>) {
  const u = new URL("/settings", req.url);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v.slice(0, 400));
  const res = NextResponse.redirect(u);
  res.cookies.set(STATE_COOKIE, "", { path: "/api/oauth", maxAge: 0 });
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (!isOAuthProvider(provider)) return done(req, { error: "Unknown connection type." });
  const label = PROVIDER_LABEL[provider];
  const sp = req.nextUrl.searchParams;

  const denied = sp.get("error_description") ?? sp.get("error_reason") ?? sp.get("error");
  if (denied) return done(req, { error: `${label} sign-in was cancelled or denied (${denied.replace(/\+/g, " ")}).` });

  const state = await verifyState(sp.get("state"), req.cookies.get(STATE_COOKIE)?.value);
  if (!state || state.provider !== provider) return done(req, { error: `${label} sign-in expired or came from another browser. Please try again.` });

  const user = await getUser();
  if (!user || user.email !== state.user) return done(req, { error: "Please sign in again, then reconnect." });

  const code = sp.get("code");
  const redirect = redirectUri(provider, req.nextUrl.origin);
  if (!code || !redirect) return done(req, { error: `${label} didn't send back an authorization code.` });

  try {
    if (provider === "instagram") {
      const c = await exchangeInstagramCode(code, redirect);
      await saveConnection({ provider, clientId: state.clientId, ...c }, user.email);
      return done(req, { connected: provider, ...(state.clientId ? { client: state.clientId } : {}) });
    }
    const g = await exchangeGoogleCode(code, redirect);
    if (provider === "gmail") {
      const profile = await gmailProfile(g.tokens.accessToken);
      const email = profile.emailAddress.toLowerCase();
      await saveConnection({ provider, clientId: null, label: email, externalId: email, tokens: { ...g.tokens, email }, scopes: g.scopes, expiresAt: null }, user.email);
    } else {
      const ext = g.sub ?? g.email ?? "google";
      await saveConnection({ provider, clientId: null, label: g.email ?? "Google account", externalId: ext, tokens: g.tokens, scopes: g.scopes, expiresAt: null }, user.email);
    }
    return done(req, { connected: provider });
  } catch (e) {
    return done(req, { error: `Couldn't finish connecting ${label}: ${errorText(e)}` });
  }
}
