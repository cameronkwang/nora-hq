"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  INVOICE_STATUS_LABEL,
  doneActions,
  dueLabel,
  formatCents,
  invoicePdfPath,
  type InvoiceDone,
} from "@/lib/invoices-types";
import type { IntakeLang } from "@/lib/schema";
import { copyText } from "./copy-button";
import { Status, buttonClass, cx } from "./ui";

const LANGS: Array<{ code: IntakeLang; label: string; htmlLang: string }> = [
  { code: "en", label: "English", htmlLang: "en" },
  { code: "zh-Hans", label: "简体中文", htmlLang: "zh-Hans" },
  { code: "zh-Hant", label: "繁體中文", htmlLang: "zh-Hant" },
];

/** Phones only (docs/invoicing.md "The done state"): Web Share with a PDF file, on a touch screen. */
function canShareFiles(): boolean {
  try {
    if (typeof navigator.canShare !== "function" || typeof navigator.share !== "function") return false;
    if (!window.matchMedia("(max-width: 767px), (pointer: coarse)").matches) return false;
    return navigator.canShare({ files: [new File([new Uint8Array([37])], "check.pdf", { type: "application/pdf" })] });
  } catch {
    return false;
  }
}

type CopyState = "idle" | "copied" | "failed";

function useCopied() {
  const [state, setState] = useState<Record<string, CopyState>>({});
  const timers = useRef<Record<string, number>>({});
  const copy = async (key: string, text: string) => {
    const ok = await copyText(text);
    setState((s) => ({ ...s, [key]: ok ? "copied" : "failed" }));
    window.clearTimeout(timers.current[key]);
    timers.current[key] = window.setTimeout(() => setState((s) => ({ ...s, [key]: "idle" })), 2000);
  };
  return { state, copy };
}

/**
 * "Make PDF" landed: Share PDF (phones), Download PDF, Copy message (in the customer's language), Copy pay link (only
 * with an online way), then the next step. iOS only lets share() run inside a fresh tap, so the PDF is fetched as a
 * File as soon as this appears and Share is a second tap on a ready file; while it loads the button says "Getting
 * PDF…", and if fetching fails it falls back to Download. One ink-filled button: Share on phones, Download on desktop
 * (`focal={false}` on the invoice page, whose focal button is Record payment).
 */
export function InvoiceDoneView({
  done,
  focal = true,
  showHead = true,
  onNew,
  headingRef,
}: {
  done: InvoiceDone;
  focal?: boolean;
  showHead?: boolean;
  onNew?: () => void;
  headingRef?: React.Ref<HTMLHeadingElement>;
}) {
  const [share, setShare] = useState<"no" | "loading" | "ready" | "failed">("no");
  const file = useRef<File | null>(null);
  const [lang, setLang] = useState<IntakeLang>(done.lang);
  const { state: copied, copy } = useCopied();
  const [shareError, setShareError] = useState("");

  useEffect(() => {
    if (!canShareFiles()) return;
    let live = true;
    setShare("loading");
    const t0 = performance.now();
    fetch(done.pdfPath, { cache: "no-store", credentials: "same-origin" })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        if (!live) return;
        file.current = new File([blob], done.fileName, { type: "application/pdf" });
        try {
          performance.measure("invoice:pdf-fetch", { start: t0, end: performance.now() });
        } catch {
          /* old browsers: no timing */
        }
        setShare("ready");
      })
      .catch(() => live && setShare("failed"));
    return () => {
      live = false;
    };
  }, [done.pdfPath, done.fileName]);

  const actions = doneActions(done, { canShareFiles: share === "loading" || share === "ready" });
  const shareFocal = focal && actions.includes("share_pdf");
  const message = done.messages[lang] ?? done.message;
  const status = done.balanceCents <= 0 ? INVOICE_STATUS_LABEL.paid : INVOICE_STATUS_LABEL.sent;
  const steps = done.nextSteps.filter((s) => s.kind === "make_contract" || s.kind === "make_invoice");

  async function onShare() {
    if (!file.current) return;
    setShareError("");
    try {
      await navigator.share({ files: [file.current], title: done.fileName.replace(/\.pdf$/, "") });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return; // she closed the share sheet
      setShareError("Couldn't open sharing. Use Download PDF.");
      setShare("failed");
    }
  }

  return (
    <section className="inv-done" aria-labelledby={showHead ? `done-${done.id}` : undefined} aria-label={showHead ? undefined : "Send it"}>
      {showHead && (
        <header className="inv-done-head">
          {/* Focused after Make PDF so a screen reader reads the result; never tabbed to, so no ring (the global
              focus ring is unlayered, hence inline). */}
          <h2 id={`done-${done.id}`} ref={headingRef} tabIndex={-1} className="inv-done-title" style={{ outline: "none" }}>
            <span className="num">{done.number}</span>
            <span aria-hidden className="text-faint"> · </span>
            <span className="num">{formatCents(done.totalCents, { decimals: "always" })}</span>
            <span aria-hidden className="text-faint"> · </span>
            <span className="[overflow-wrap:anywhere]">{done.customerName}</span>
          </h2>
          <p className="inv-done-meta">
            <Status tone={done.balanceCents <= 0 ? "ok" : "info"} small>{status}</Status>
            <span className="meta">{dueLabel(done.issueDate, done.dueDate)}</span>
            <span className="meta">The PDF is ready to send</span>
          </p>
        </header>
      )}

      <div className="inv-done-actions">
        {actions.map((a) => {
          if (a === "share_pdf")
            return (
              <button key={a} type="button" onClick={onShare} disabled={share !== "ready"} className={buttonClass(shareFocal ? "primary" : "secondary")}>
                {share === "ready" ? "Share PDF" : "Getting PDF…"}
              </button>
            );
          if (a === "download_pdf")
            return (
              <a key={a} href={invoicePdfPath(done.id, { download: true })} download={done.fileName} className={buttonClass(focal && !shareFocal ? "primary" : "secondary")}>
                Download PDF
              </a>
            );
          if (a === "copy_message")
            return (
              <button key={a} type="button" onClick={() => copy("message", message)} className={buttonClass("secondary")}>
                <span aria-live="polite">{copied.message === "copied" ? "Copied ✓" : copied.message === "failed" ? "Copy failed" : "Copy message"}</span>
              </button>
            );
          return (
            <button key={a} type="button" onClick={() => done.payUrl && copy("link", done.payUrl)} className={buttonClass("secondary")}>
              <span aria-live="polite">{copied.link === "copied" ? "Copied ✓" : copied.link === "failed" ? "Copy failed" : "Copy pay link"}</span>
            </button>
          );
        })}
      </div>
      {shareError && <p role="alert" className="mt-2"><Status tone="danger" small className="is-wrap">{shareError}</Status></p>}

      {/* The text "Copy message" copies, so she sees what goes with the PDF. In the customer's language; the others one tap away. */}
      <div className="inv-msg">
        <div className="inv-msg-head">
          <p className="eyebrow">Message to send with it</p>
          <div className="seg" role="group" aria-label="Message language">
            {LANGS.map((l) => (
              <button key={l.code} type="button" lang={l.htmlLang} aria-pressed={lang === l.code} onClick={() => setLang(l.code)}>
                {l.label}
              </button>
            ))}
          </div>
        </div>
        <p lang={LANGS.find((l) => l.code === lang)?.htmlLang} className="inv-msg-text">{message}</p>
      </div>

      {/* On the invoice page (no head) the next steps have their own place, so they aren't repeated here. */}
      {showHead && (
        <nav aria-label="Next" className="inv-next">
          <span className="meta">Next:</span>
          {steps.map((s) => (
            <Link key={s.kind} href={"href" in s ? s.href : "#"} className={cx("link", "tap-target")}>
              {s.label}
            </Link>
          ))}
          {onNew ? (
            <button type="button" onClick={onNew} className="link tap-target inv-linkbtn">
              New invoice
            </button>
          ) : (
            showHead && <Link href="/invoices/new" className="link tap-target">New invoice</Link>
          )}
          {showHead && (
            <Link href={`/invoices/${encodeURIComponent(done.id)}`} className="link tap-target">
              Open invoice
            </Link>
          )}
        </nav>
      )}
    </section>
  );
}
