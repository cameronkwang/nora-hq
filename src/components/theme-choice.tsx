"use client";

import { useEffect, useState } from "react";
import { THEME_KEY as KEY } from "@/lib/theme";
import { cx } from "./ui";

type Theme = "auto" | "light" | "dark";
const OPTIONS: { value: Theme; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/**
 * Auto follows the phone's day/night setting; Light or Dark sticks on this device.
 * Drawn as `.seg` (globals.css): three quiet text buttons, the chosen one reads like the current sidebar row.
 */
export function ThemeChoice({ className }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>("auto");

  useEffect(() => {
    const t = document.documentElement.dataset.theme;
    setTheme(t === "light" || t === "dark" ? t : "auto");
  }, []);

  function choose(next: Theme) {
    setTheme(next);
    const root = document.documentElement;
    if (next === "auto") delete root.dataset.theme;
    else root.dataset.theme = next;
    // The phone's browser and status bar follow data-theme too: the root layout's script watches it.
    try {
      if (next === "auto") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch {
      /* private mode: the choice lasts until the page closes */
    }
  }

  return (
    <div role="radiogroup" aria-label="Appearance" className={cx("seg", className)}>
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={theme === o.value}
          onClick={() => choose(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
