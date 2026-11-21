"use client";

import Link from "next/link";
import { useState } from "react";
import { formatCents, usDate, type ImportKind, type ImportPreview, type ImportResult } from "@/lib/invoices-types";
import { previewImportAction, saveImportAction } from "@/app/(app)/invoices/actions";
import { Status, buttonClass, cx } from "./ui";

/**
 * Two steps: Preview (writes nothing; each row says what will happen) and Save (the server parses the same text
 * again; it never trusts the browser's rows). Imported invoices keep Skynova's numbers; the next Nora HQ number
 * moves past them.
 */
export function InvoiceImport() {
  const [kind, setKind] = useState<ImportKind>("invoices");
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [previewed, setPreviewed] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState<null | "preview" | "save">(null);
  const [error, setError] = useState("");

  const stale = !!preview && (previewed !== `${kind}\n${text}`);
  const rows = preview ? (kind === "customers" ? preview.customers.length : preview.invoices.length) : 0;
  const good = preview ? (kind === "customers" ? preview.customers.filter((r) => !r.issues.length).length : preview.invoices.filter((r) => !r.issues.length && !r.existingInvoiceId).length) : 0;

  async function doPreview() {
    setBusy("preview");
    setError("");
    setResult(null);
    const r = await previewImportAction(text, kind).catch(() => ({ ok: false as const, error: "Couldn't read it. Try again." }));
    setBusy(null);
    if (!r.ok) return setError(r.error);
    setPreview(r.preview);
    setPreviewed(`${kind}\n${text}`);
  }

  async function doSave() {
    setBusy("save");
    setError("");
    const r = await saveImportAction(text, kind).catch(() => ({ ok: false as const, error: "Couldn't save it. Try again." }));
    setBusy(null);
    if (!r.ok) return setError(r.error);
    setResult(r.result);
    setPreview(null);
    setText("");
  }

  return (
    <div className="grid max-w-3xl gap-6">
      <div role="radiogroup" aria-label="What you're pasting" className="chips">
        {(["invoices", "customers"] as const).map((k) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} className="chip" onClick={() => setKind(k)}>
            <span>{k === "invoices" ? "Invoices" : "Customers"}</span>
          </button>
        ))}
      </div>
      <div>
        <label htmlFor="imp-text" className="label">Paste here</label>
        <textarea
          id="imp-text"
          className="input inv-paste"
          rows={8}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={kind === "invoices" ? "Invoice #\tCustomer\tDate\tDue Date\tTotal\tAmount Paid\n0000168\tSample Bistro\t11/01/2026\t11/01/2026\t550.00\t0.00" : "Customer\tEmail\tPhone\tAddress\nSample Bistro\towner@example.com\t(555) 010-0199\t1 Example Ave, Sampleton, VA 23000"}
          spellCheck={false}
        />
        <p className="hint">Tab, comma or semicolon separated, with a header row. Card or bank numbers are refused.</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={buttonClass(preview && !stale ? "secondary" : "primary")} disabled={!text.trim() || !!busy} onClick={doPreview}>
          {busy === "preview" ? "Reading…" : preview ? "Preview again" : "Preview"}
        </button>
        {preview && !stale && good > 0 && (
          <button type="button" className={buttonClass("primary")} disabled={!!busy} onClick={doSave}>
            {busy === "save" ? "Saving…" : `Save ${good} ${kind === "customers" ? (good === 1 ? "customer" : "customers") : good === 1 ? "invoice" : "invoices"}`}
          </button>
        )}
        {stale && <Status tone="warn" small>The text changed. Preview again before saving.</Status>}
      </div>
      {error && <p role="alert"><Status tone="danger" className="is-wrap">{error}</Status></p>}

      {result && (
        <div role="status" className="notice">
          <Status tone="ok" className="is-wrap">
            Saved {result.invoicesCreated} {result.invoicesCreated === 1 ? "invoice" : "invoices"}, {result.customersCreated} new {result.customersCreated === 1 ? "customer" : "customers"} ({result.customersMatched} matched), {result.paymentsCreated} {result.paymentsCreated === 1 ? "payment" : "payments"}. The next invoice number is {result.nextNumber}.
            {result.skipped.length > 0 && ` Skipped ${result.skipped.length}: ${result.skipped.slice(0, 5).map((s) => `line ${s.line} (${s.reason})`).join(", ")}.`}
          </Status>
          <Link href="/invoices" className="link">See invoices</Link>
        </div>
      )}

      {preview && (
        <section aria-label="Preview" className="grid gap-3">
          <p className="meta">
            {rows} {rows === 1 ? "row" : "rows"} read · {good} to save
            {Object.keys(preview.mapping).length > 0 && ` · columns: ${Object.entries(preview.mapping).map(([k, v]) => `${k} ← ${v}`).join(", ")}`}
          </p>
          <div className="inv-preview">
            {kind === "invoices" ? (
              <table className="inv-table">
                <thead>
                  <tr><th scope="col">Line</th><th scope="col">Number</th><th scope="col">Customer</th><th scope="col">Date</th><th scope="col">Total</th><th scope="col">Paid</th><th scope="col">What happens</th></tr>
                </thead>
                <tbody>
                  {preview.invoices.map((r) => (
                    <tr key={r.line}>
                      <td className="num">{r.line}</td>
                      <td className="num">{r.number}</td>
                      <td>{r.customerName}</td>
                      <td className="num">{usDate(r.issueDate)}</td>
                      <td className="num">{formatCents(r.totalCents)}</td>
                      <td className="num">{formatCents(r.paidCents)}</td>
                      <td className={cx(r.issues.length || r.existingInvoiceId ? "text-muted" : undefined)}>
                        {r.issues.length ? <Status tone="warn" small className="is-wrap">{r.issues.join(", ")}</Status> : r.existingInvoiceId ? "Already imported" : r.existingCustomerId ? "New invoice, existing customer" : "New invoice and customer"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="inv-table">
                <thead>
                  <tr><th scope="col">Line</th><th scope="col">Name</th><th scope="col">Contact</th><th scope="col">Email</th><th scope="col">What happens</th></tr>
                </thead>
                <tbody>
                  {preview.customers.map((r) => (
                    <tr key={r.line}>
                      <td className="num">{r.line}</td>
                      <td>{r.name}</td>
                      <td>{r.contactName}</td>
                      <td>{r.email}</td>
                      <td>{r.issues.length ? <Status tone="warn" small className="is-wrap">{r.issues.join(", ")}</Status> : r.existingCustomerId ? "Matches an existing customer" : "New customer"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {preview.skipped.length > 0 && <p className="meta">Not rows: {preview.skipped.slice(0, 8).map((s) => `line ${s.line} (${s.reason})`).join(", ")}{preview.skipped.length > 8 ? "…" : ""}</p>}
        </section>
      )}
    </div>
  );
}
