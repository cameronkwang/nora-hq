"use client";

import { useEffect } from "react";
import { INTAKE_COPY, INTAKE_LANG_CODES, INTAKE_LANG_COOKIE, type IntakeLangCode } from "@/lib/intake-copy";
import { cx } from "./ui";

/**
 * English · 简体 · 繁體 switch for the onboarding form. Plain links (?lang=…), so it works without JavaScript;
 * with JavaScript the choice is also remembered in a cookie for the next visit.
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
    <nav aria-label={INTAKE_COPY[lang].common.language} className="flex justify-center">
      <ul className="inline-flex rounded-full border border-border bg-surface p-1 shadow-sm">
        {INTAKE_LANG_CODES.map((code) => (
          <li key={code}>
            <a
              href={`?lang=${code}`}
              lang={INTAKE_COPY[code].htmlLang}
              aria-current={code === lang ? "true" : undefined}
              className={cx(
                "flex min-h-11 min-w-16 items-center justify-center rounded-full px-4 text-[16px] font-medium transition-colors",
                code === lang ? "bg-accent text-accent-fg" : "text-muted hover:bg-surface-2 hover:text-text",
              )}
            >
              {INTAKE_COPY[code].langName}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
