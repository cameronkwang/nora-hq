import type { ReactNode } from "react";
import { HtmlLang, IntakeLangSwitch } from "./intake-lang";
import { intakeCopy, type IntakeLangCode } from "@/lib/intake-copy";

/**
 * The onboarding form's page frame (our name, the language switch, one column on paper): shared by the owner's private
 * link (/start/<token>), the team's preview of it (/start-preview/<business id>) and the owner drop link (/drop/<token>),
 * so the preview is what the owner sees.
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
  /** "Your answers save on this device…" under the form, while the form is open. */
  footnote?: boolean;
  /** Shown above everything (the team preview's "nothing is saved" note). */
  banner?: ReactNode;
  children: ReactNode;
}) {
  const C = intakeCopy(lang);
  return (
    <main
      lang={C.htmlLang}
      className="ps-page"
      // No tab bar here: the sticky action bar sits on the bottom edge and covers the home indicator itself.
      style={{ ["--tabbar-h" as string]: "0px" }}
    >
      <HtmlLang lang={C.htmlLang} />
      <style>{FOLLOW_UP_CSS}</style>
      <noscript>
        <style>{NO_JS_CSS}</style>
      </noscript>
      <div className="ps-col">
        {banner}
        <header className="ps-top">
          <p className="ps-mark">{C.brand}</p>
          <IntakeLangSwitch lang={lang} remember={rememberLang} />
        </header>

        {children}

        {footnote && (
          <p className="meta mt-8 [main:has([data-intake-done])_&]:hidden">
            {C.common.autosave}
          </p>
        )}
      </div>
    </main>
  );
}
