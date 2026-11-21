import { cache } from "react";
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { InvoicePublicView, InvoicePublicVoid, type InvoicePublicNotice } from "@/components/invoice-public";
import { isIntakeLang, langFromAcceptLanguage, parseIntakeLang, type IntakeLangCode } from "@/lib/intake-copy";
import { invoiceCopy } from "@/lib/invoice-copy";
import { getInvoiceByToken, getInvoiceSettings, markInvoiceViewed } from "@/lib/ops-invoices";
import { isPayErrorKey } from "@/lib/ops-stripe";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

/**
 * PUBLIC: no sign-in, no app chrome (outside the (app) group; middleware lets "/i" through). The customer's private
 * invoice link /i/<token>, made when an invoice is finalized (Make PDF). The token is the only key: only its sha256
 * is looked up (lib/ops-invoices getInvoiceByToken). A token that was never a link (or is a draft's) answers 404; a
 * cancelled invoice shows "This invoice was cancelled" and nothing else. Otherwise exactly this invoice and its
 * chosen ways to pay, Zelle first (components/invoice-public). Copy: lib/invoice-copy `page`.
 * Language: ?lang= → the invoice's (else its customer's) → Accept-Language.
 * ?paid=1 is Stripe's way back after paying; ?pay=<reason> is the Pay online route's way back when it couldn't start.
 * The customer opening it stamps "viewed" (after the response); a signed-in person or a link-preview bot does not.
 */

export const dynamic = "force-dynamic";

type SP = { lang?: string | string[]; paid?: string | string[]; pay?: string | string[] };
type Props = { params: Promise<{ token: string }>; searchParams: Promise<SP> };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const load = cache((token: string) => getInvoiceByToken(token));

/**
 * Chat apps fetch a link to draw its preview; that isn't the customer looking at it. (In-app browsers such as WeChat's
 * MicroMessenger or LINE are real people and are not in this list.)
 */
const PREVIEW_BOT = /(bot|crawler|spider)\b|preview|facebookexternalhit|whatsapp\/|embedly|curl\/|wget\/|python-requests|headless/i;

async function pickLang(sp: SP, saved: string | null | undefined): Promise<IntakeLangCode> {
  const fromQuery = parseIntakeLang(one(sp.lang));
  if (fromQuery) return fromQuery;
  if (isIntakeLang(saved)) return saved;
  return langFromAcceptLanguage((await headers()).get("accept-language"));
}

const savedLang = (found: Awaited<ReturnType<typeof getInvoiceByToken>>) =>
  found.state === "open" ? found.invoice.lang : found.state === "void" ? found.lang : null;

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ token }, sp] = await Promise.all([params, searchParams]);
  const found = await load(token);
  const P = invoiceCopy(await pickLang(sp, savedLang(found))).page;
  return {
    // Only the number: a link preview in a chat must not show amounts or names.
    title: { absolute: found.state === "open" ? P.meta.title(found.invoice.number) : P.meta.generic },
    robots: { index: false, follow: false, nocache: true },
    referrer: "no-referrer", // the token is in the URL: never leak it to other sites
  };
}

export default async function InvoicePublicPage({ params, searchParams }: Props) {
  const [{ token }, sp] = await Promise.all([params, searchParams]);
  const found = await load(token);
  if (found.state === "unknown") notFound();
  const lang = await pickLang(sp, savedLang(found));

  if (found.state === "void") {
    const settings = await getInvoiceSettings();
    return <InvoicePublicVoid lang={lang} fromName={settings.fromName} />;
  }

  const [jar, h] = await Promise.all([cookies(), headers()]);
  const signedIn = !!(await verifySession(jar.get(SESSION_COOKIE)?.value));
  const ua = h.get("user-agent") ?? "";
  const purpose = `${h.get("purpose") ?? ""} ${h.get("sec-purpose") ?? ""} ${h.get("next-router-prefetch") ?? ""}`;
  if (!signedIn && ua && !PREVIEW_BOT.test(ua) && !/prefetch|prerender/i.test(purpose)) {
    const id = found.invoice.id;
    after(() => markInvoiceViewed(id).catch((e) => console.error("[invoice] mark viewed failed", e instanceof Error ? e.message : e)));
  }

  const P = invoiceCopy(lang).page;
  const payReason = one(sp.pay);
  const notice: InvoicePublicNotice = one(sp.paid) === "1"
    ? { kind: "thanks" }
    : isPayErrorKey(payReason) ? { kind: "error", message: P.errors[payReason] } : null;

  return <InvoicePublicView lang={lang} token={token} invoice={found.invoice} options={found.options} notice={notice} />;
}
