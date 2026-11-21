"use client";

import { useEffect, useRef, useState } from "react";
import { copyText } from "./copy-button";
import { buttonClass, cx } from "./ui";

/**
 * The customer's page (/i/<token>): a small Copy button next to the Zelle number, the invoice number for the memo, a
 * Venmo or PayPal handle. Words come from lib/invoice-copy in the page's language (the shared CopyButton is English
 * only). Without JavaScript the button is hidden (`hidden` until mounted): the value stays on the page as plain text.
 */
export function InvoicePublicCopy({ text, label, copied, failed, what }: { text: string; label: string; copied: string; failed: string; what: string }) {
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<number | null>(null);
  useEffect(() => {
    setReady(true);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);
  return (
    <button
      type="button"
      hidden={!ready}
      aria-label={state === "idle" ? what : undefined}
      className={cx(buttonClass("secondary", "sm"), "ip-copy")}
      onClick={async () => {
        const ok = await copyText(text);
        setState(ok ? "copied" : "failed");
        if (timer.current) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setState("idle"), 2000);
      }}
    >
      <span aria-live="polite">{state === "copied" ? `${copied} ✓` : state === "failed" ? failed : label}</span>
    </button>
  );
}
