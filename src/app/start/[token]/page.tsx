import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { IntakeForm } from "@/components/intake-form";
import { IntakeLangSwitch } from "@/components/intake-lang";
import { IntakeAlready, IntakeExpired } from "@/components/intake-screens";
import { INTAKE_LANG_COOKIE, intakeCopy, isIntakeLang, langFromAcceptLanguage, parseIntakeLang, type IntakeLangCode } from "@/lib/intake-copy";
import { getIntakeByToken, intakeAccessEmail, markIntakeOpened } from "@/lib/ops-intake";
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

// Without JavaScript the steps can't switch, so show every step as one long form and keep only "Send".
const NO_JS_CSS = `
.intake-step[data-off="true"] { display: block; }
.intake-submit[data-off="true"] { display: inline-flex; margin-left: auto; }
.intake-js { display: none !important; }
.intake-nojs { display: inline; }
.intake-step + .intake-step { margin-top: 2.5rem; padding-top: 2rem; border-top: 1px solid var(--border); }
`;

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
    // Start from what we already know, so they only fix or add.
    const initial: Record<string, string> = {
      businessName: c.name,
      ...(c.instagramHandle ? { instagram: `@${c.instagramHandle}` } : {}),
      ...(c.tiktokHandle ? { tiktok: `@${c.tiktokHandle}` } : {}),
      ...(c.website ? { website: c.website } : {}),
      ...(c.ownerEmail ? { contactEmail: c.ownerEmail } : {}),
    };
    body = (
      <IntakeForm
        token={token}
        intakeId={link.intake.id}
        lang={lang}
        businessName={c.name}
        initial={initial}
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
    <main
      lang={C.htmlLang}
      className="min-h-dvh px-[max(1rem,env(safe-area-inset-left))] pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(1.25rem,env(safe-area-inset-top))] text-[16px] sm:pt-10"
      // No tab bar here: sticky actions sit on the bottom edge (above the home indicator).
      style={{ ["--tabbar-h" as string]: "env(safe-area-inset-bottom)" }}
    >
      <noscript>
        <style>{NO_JS_CSS}</style>
      </noscript>
      <div className="mx-auto w-full max-w-xl">
        <header className="mb-6 text-center sm:mb-8">
          <IntakeLangSwitch lang={lang} remember={explicit} />
          <span
            aria-hidden
            className="mx-auto mb-3 mt-6 flex size-14 items-center justify-center rounded-full bg-accent text-xl font-semibold text-accent-fg shadow-sm"
          >
            N
          </span>
          <p className="text-[15px] font-medium text-accent">{C.brand}</p>
        </header>

        <div className="rounded-3xl border border-border bg-surface p-4 shadow-sm sm:p-8">{body}</div>

        {link.state === "open" && (
          <p className="mx-auto mt-6 max-w-sm text-center text-sm leading-relaxed text-muted">
            {C.common.autosave} {C.common.neverPasswords}
          </p>
        )}
      </div>
    </main>
  );
}
