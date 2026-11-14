import { cache } from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { DropForm } from "@/components/drop-form";
import { IntakeShell } from "@/components/intake-shell";
import { IntakeExpired } from "@/components/intake-screens";
import { intakeCopy, isIntakeLang, langFromAcceptLanguage, parseIntakeLang, type IntakeLangCode } from "@/lib/intake-copy";
import { dropCopy } from "@/lib/drop-copy";
import { dropFolder, getDropByToken } from "@/lib/ops-drop";
import { blobEnabled } from "@/lib/uploads";

/**
 * PUBLIC — no sign-in, no app chrome (outside the (app) group; middleware lets "/drop" through).
 * A business owner's private, long-lived "send us a flyer" page: a photo + "what's the deal, when does it end".
 * The token in the URL is the only key; each drop becomes an ask for Claude (lib/ops-drop). Copy: lib/drop-copy.
 * A token that was never a link answers 404; a link that was turned off shows "This link has expired".
 * Language: ?lang= → the language they last used here (or answered their onboarding form in) → Accept-Language.
 */

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ token: string }>; searchParams: Promise<{ lang?: string | string[] }> };

const loadLink = cache((token: string) => getDropByToken(token));

async function pickLang(sp: { lang?: string | string[] }, saved: string | null | undefined): Promise<IntakeLangCode> {
  const fromQuery = parseIntakeLang(Array.isArray(sp.lang) ? sp.lang[0] : sp.lang);
  if (fromQuery) return fromQuery;
  if (isIntakeLang(saved)) return saved;
  const h = await headers();
  return langFromAcceptLanguage(h.get("accept-language"));
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ token }, sp] = await Promise.all([params, searchParams]);
  const link = await loadLink(token);
  const D = dropCopy(await pickLang(sp, link.state === "open" ? link.link.lang : null));
  return {
    title: { absolute: D.meta.title },
    description: D.meta.description,
    robots: { index: false, follow: false, nocache: true },
    referrer: "no-referrer", // the token is in the URL: never leak it to other sites
  };
}

export default async function DropPage({ params, searchParams }: Props) {
  const [{ token }, sp] = await Promise.all([params, searchParams]);
  const link = await loadLink(token);
  // Never a link at all: a plain 404. (A link that was turned off gets the friendly "expired" screen below.)
  if (link.state === "unknown") notFound();
  const lang = await pickLang(sp, link.state === "open" ? link.link.lang : null);

  return (
    <IntakeShell lang={lang} rememberLang={false}>
      {link.state === "open" ? (
        <DropForm
          token={token}
          lang={lang}
          businessName={link.client.name}
          // Uploads go under this link's own folder, one sub-folder per day (the upload route caps files per day).
          folder={`${dropFolder(link.link.id)}${new Date().toISOString().slice(0, 10)}`}
          uploadsEnabled={blobEnabled()}
        />
      ) : (
        <IntakeExpired C={intakeCopy(lang)} />
      )}
    </IntakeShell>
  );
}
