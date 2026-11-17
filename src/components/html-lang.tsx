"use client";

import { useEffect } from "react";

/**
 * Sets the page's root language (<html lang>) while this is mounted, and puts the old one back on the way out.
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
