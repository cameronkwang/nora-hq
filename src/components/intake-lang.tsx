"use client";

import { useEffect } from "react";
import { INTAKE_COPY, INTAKE_LANG_CODES, INTAKE_LANG_COOKIE, type IntakeLangCode } from "@/lib/intake-copy";

/**
 * English · 简体 · 繁體 switch for the onboarding form. Plain links (?lang=…), so it works without JavaScript;
 * with JavaScript the choice is also remembered in a cookie for the next visit. Drawn as chips: the current one is ink.
 */
export function IntakeLangSwitch({ lang, remember }: { lang: IntakeLangCode; remember: boolean }) {
  useEffect(() => {
    if (!remember) return;
    try {
      document.cookie = `${INTAKE_LANG_COOKIE}=${lang}; path=/start; max-age=31536000; samesite=lax`;
    } catch {
      /* cookies blocked: ?lang= still works */
    }
  }, [lang, remember]);

  return (
    <nav aria-label={INTAKE_COPY[lang].common.language}>
      <ul className="chips">
        {INTAKE_LANG_CODES.map((code) => (
          <li key={code}>
            <a
              href={`?lang=${code}`}
              lang={INTAKE_COPY[code].htmlLang}
              aria-current={code === lang ? "true" : undefined}
              className="chip"
            >
              <span>{INTAKE_COPY[code].langName}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * Sets the page's root language (<html lang>) while it is mounted, and puts the old one back on the way out.
 * The root layout is shared and says "en"; the owner-facing pages are in English, 简体 or 繁體, so they state their
 * own (the <title> and anything outside <main> then count as that language too). Renders nothing.
 */
export function HtmlLang({ lang }: { lang: string }) {
  useEffect(() => {
    const root = document.documentElement;
    const before = root.lang;
    root.lang = lang;
    return () => {
      root.lang = before;
    };
  }, [lang]);
  return null;
}
