import type { ReactNode } from "react";
import { IntakeLangSwitch } from "./intake-lang";
import { intakeCopy, type IntakeLangCode } from "@/lib/intake-copy";

/**
 * The onboarding form's page frame (language switch, brand mark, card): shared by the owner's private link
 * (/start/<token>) and the team's preview of it (/start-preview/<business id>), so the preview is what the owner sees.
 */

// Without JavaScript the steps can't switch, so show every step as one long form and keep only "Send".
const NO_JS_CSS = `
.intake-step[data-off="true"] { display: block; }
.intake-submit[data-off="true"] { display: inline-flex; margin-left: auto; }
.intake-js { display: none !important; }
.intake-nojs { display: inline; }
.intake-step + .intake-step { margin-top: 2.5rem; padding-top: 2rem; border-top: 1px solid var(--border); }
`;

// Follow-up questions show only once they apply. Pure CSS, so it works with JavaScript off too; a browser without
// :has() simply shows them all the time.
const FOLLOW_UP_CSS = `
@supports selector(:has(*)) {
  .intake-form .if-creators, .intake-form .if-other-lang, .intake-form .if-facts-off { display: none; }
  .intake-form:has(input[name="creatorsOk"][value="yes"]:checked, input[name="creatorsOk"][value="maybe"]:checked) .if-creators { display: block; }
  .intake-form:has(input[name="factsOk"][value="no"]:checked) .if-facts-off { display: block; }
  .intake-form:has(select[name="talkLang"] option[value="other"]:checked) .if-other-lang, .intake-form .if-other-lang[data-on="true"] { display: block; }
}
`;

export function IntakeShell({
  lang, rememberLang, footnote, banner, children,
}: {
  lang: IntakeLangCode;
  /** Remember the picked language in a cookie (the owner's link only). */
  rememberLang: boolean;
  /** "Your answers save on this device…" under the card, while the form is open. */
  footnote?: boolean;
  /** Shown above everything (the team preview's "nothing is saved" note). */
  banner?: ReactNode;
  children: ReactNode;
}) {
  const C = intakeCopy(lang);
  return (
    <main
      lang={C.htmlLang}
      className="min-h-dvh px-[max(1rem,env(safe-area-inset-left))] pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(1.25rem,env(safe-area-inset-top))] text-[16px] sm:pt-10"
      // No tab bar here: sticky actions sit on the bottom edge (above the home indicator).
      style={{ ["--tabbar-h" as string]: "env(safe-area-inset-bottom)" }}
    >
      <style>{FOLLOW_UP_CSS}</style>
      <noscript>
        <style>{NO_JS_CSS}</style>
      </noscript>
      <div className="mx-auto w-full max-w-xl">
        {banner}
        <header className="mb-6 text-center sm:mb-8">
          <IntakeLangSwitch lang={lang} remember={rememberLang} />
          <span
            aria-hidden
            className="mx-auto mb-3 mt-6 flex size-14 items-center justify-center rounded-full bg-accent text-xl font-semibold text-accent-fg shadow-sm"
          >
            N
          </span>
          <p className="text-[15px] font-medium text-accent">{C.brand}</p>
        </header>

        <div className="rounded-3xl border border-border bg-surface p-4 shadow-sm sm:p-8">{children}</div>

        {footnote && (
          <p className="mx-auto mt-6 max-w-sm text-center text-sm leading-relaxed text-muted [main:has([data-intake-done])_&]:hidden">
            {C.common.autosave} {C.common.neverPasswords}
          </p>
        )}
      </div>
    </main>
  );
}
