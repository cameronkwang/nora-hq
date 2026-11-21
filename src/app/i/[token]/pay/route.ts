import { NextResponse } from "next/server";
import { PayLinkGoneError, PayOnlineError, startCheckout } from "@/lib/ops-stripe";
import { isIntakeLang, type IntakeLangCode } from "@/lib/intake-copy";

/**
 * POST /i/<token>/pay: PUBLIC (the private link token is the only key). The page's "Pay online" form posts here, so
 * it works without JavaScript. lib/ops-stripe startCheckout reads the balance from the database (nothing in this
 * request sets the amount), then this answers 303 to Stripe's hosted Checkout. When it can't start, 303 back to the
 * page with ?pay=<reason> so the page says why in the customer's language. An unknown or cancelled link is a 404.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let lang: IntakeLangCode | null = null;
  try {
    const fd = await req.formData();
    const l = fd.get("lang");
    lang = isIntakeLang(l) ? l : null;
  } catch {
    /* no form body: the invoice's own language */
  }
  const origin = new URL(req.url).origin;
  const back = (reason: string) => {
    const u = new URL(`/i/${encodeURIComponent(token)}`, origin);
    if (lang) u.searchParams.set("lang", lang);
    u.searchParams.set("pay", reason);
    return NextResponse.redirect(u, { status: 303, headers: NO_STORE });
  };
  try {
    const { url } = await startCheckout(token, { origin, lang });
    if (!/^https:\/\/checkout\.stripe\.com\//.test(url)) {
      console.error("[stripe] unexpected checkout URL host; not redirecting");
      return back("failed");
    }
    return NextResponse.redirect(url, { status: 303, headers: NO_STORE });
  } catch (e) {
    if (e instanceof PayLinkGoneError) return new NextResponse("Not found", { status: 404, headers: NO_STORE });
    if (e instanceof PayOnlineError) return back(e.key);
    console.error("[stripe] pay failed", e instanceof Error ? e.message : e);
    return back("failed");
  }
}

/** A GET (someone opened /pay directly): back to the page. */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return NextResponse.redirect(new URL(`/i/${encodeURIComponent(token)}`, req.url), { status: 303, headers: NO_STORE });
}
