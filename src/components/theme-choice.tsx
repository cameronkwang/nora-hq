"use client";

import { useEffect, useState } from "react";
import { cx } from "./ui";

type Theme = "auto" | "light" | "dark";
const KEY = "nora-hq:theme";
const OPTIONS: { value: Theme; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/** Auto follows the phone's day/night setting; Light or Dark sticks on this device. */
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
    try {
      if (next === "auto") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch {
      /* private mode: the choice lasts until the page closes */
    }
  }

  return (
    <div role="radiogroup" aria-label="Appearance" className={cx("grid grid-cols-3 gap-1 rounded-lg bg-surface-2 p-1", className)}>
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={theme === o.value}
          onClick={() => choose(o.value)}
          className={cx(
            "min-h-9 rounded-md px-2 text-xs font-medium",
            theme === o.value ? "bg-surface text-text shadow-sm" : "text-muted hover:text-text",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
