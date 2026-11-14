import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { IntakeForm } from "@/components/intake-form";
import { IntakeShell } from "@/components/intake-shell";
import { IntakeAlready, IntakeExpired } from "@/components/intake-screens";
import {
  INTAKE_LANG_COOKIE, intakeCopy, isIntakeLang, langFromAcceptLanguage, parseIntakeLang, type IntakeLangCode,
} from "@/lib/intake-copy";
import { getIntakeByToken, intakeAccessEmail, intakeFormSetup, markIntakeOpened } from "@/lib/ops-intake";
import { blobEnabled } from "@/lib/uploads";

/**
 * PUBLIC — no sign-in, no app chrome (outside the (app) group; middleware lets "/start" through).
 * A new client's private onboarding form. The token in the URL is the only key; copy lives in src/lib/intake-copy.ts.
 * Language: ?lang= → remembered cookie → Accept-Language (zh-TW/HK/Hant → 繁體, other zh → 简体, else English).
 */

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ token: string }>; searchParams: Promise<{ lang?: string | string[] }> };

async function pickLang(sp: { lang?: string | string[] }): Promise<{ lang: IntakeLangCode; explicit: boolean }> {
  const fromQuery = parseIntakeLang(Array.isArray(sp.lang) ? sp.lang[0] : sp.lang);
  if (fromQuery) return { lang: fromQuery, explicit: true };
  const jar = await cookies();
  const saved = jar.get(INTAKE_LANG_COOKIE)?.value;
  if (isIntakeLang(saved)) return { lang: saved, explicit: false };
  const h = await headers();
  return { lang: langFromAcceptLanguage(h.get("accept-language")), explicit: false };
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { lang } = await pickLang(await searchParams);
  const C = intakeCopy(lang);
  return {
    title: { absolute: C.meta.title },
    description: C.meta.description,
    robots: { index: false, follow: false, nocache: true },
    referrer: "no-referrer", // the token is in the URL: never leak it to links the client taps
  };
}

export default async function StartPage({ params, searchParams }: Props) {
  const [{ token }, sp] = await Promise.all([params, searchParams]);
  const { lang, explicit } = await pickLang(sp);
  const C = intakeCopy(lang);
  const link = await getIntakeByToken(token);

  if (link.state === "open") {
    const h = await headers();
    await markIntakeOpened(link.intake, h.get("user-agent")).catch((e) => console.error("[intake] mark opened failed", e));
  }

  let body: React.ReactNode;
  if (link.state === "open") {
    const c = link.client;
    // What we looked up before sending: the owner only checks it ("Is this right?").
    const setup = intakeFormSetup(c, lang);
    body = (
      <IntakeForm
        token={token}
        intakeId={link.intake.id}
        lang={lang}
        businessName={c.name}
        initial={setup.initial}
        facts={setup.facts}
        factsKey={setup.factsKey}
        askHandles={setup.askHandles}
        accessEmail={intakeAccessEmail()}
        uploadsEnabled={blobEnabled()}
      />
    );
  } else if (link.state === "submitted") {
    body = <IntakeAlready C={C} />;
  } else {
    body = <IntakeExpired C={C} />;
  }

  return (
    <IntakeShell lang={lang} rememberLang={explicit} footnote={link.state === "open"}>
      {body}
    </IntakeShell>
  );
}
