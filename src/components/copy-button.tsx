"use client";

import { useState } from "react";
import { buttonClass, cx } from "./ui";

async function copyText(text: string) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(ta);
  return ok;
}

/**
 * Copies `text`, or — if `targetId` is given — the current value of that textarea/input
 * (so edits made on the page are what gets copied).
 */
export function CopyButton({
  text,
  targetId,
  label = "Copy",
  variant = "secondary",
  size = "md",
  className,
}: {
  text?: string;
  targetId?: string;
  label?: string;
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md";
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <button
      type="button"
      className={cx(buttonClass(variant, size), className)}
      onClick={async () => {
        const el = targetId ? (document.getElementById(targetId) as HTMLTextAreaElement | HTMLInputElement | null) : null;
        const value = el?.value ?? text ?? "";
        const ok = await copyText(value);
        setState(ok ? "copied" : "failed");
        window.setTimeout(() => setState("idle"), 2000);
      }}
    >
      <span aria-live="polite">{state === "copied" ? "Copied ✓" : state === "failed" ? "Copy failed — select and copy" : label}</span>
    </button>
  );
}
