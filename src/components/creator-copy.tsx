"use client";

import { useState } from "react";
import { buttonClass, cx } from "./ui";

/** Small copy-to-clipboard button (for a handle or a public email). */
export function CreatorCopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={cx(buttonClass("ghost", "sm"), "text-muted")}
      aria-label={`${label}: ${text}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          window.prompt("Copy this:", text);
        }
      }}
    >
      <span aria-live="polite">{copied ? "Copied" : label}</span>
    </button>
  );
}
