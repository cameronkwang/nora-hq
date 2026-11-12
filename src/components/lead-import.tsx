"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { parseDelimited } from "@/app/(app)/creators/import/parse";
import {
  LEAD_FIELD_LABEL,
  LEAD_IMPORT_FIELDS,
  MAX_LEAD_IMPORT_ROWS,
  applyLeadMapping,
  guessLeadMapping,
  type LeadImportField,
} from "@/app/(app)/leads/shared";
import { importLeadChunkAction, previewLeadImportAction } from "@/app/(app)/leads/import/actions";
import type { LeadImportPreviewRow, LeadImportResult } from "@/lib/ops-leads";
import { Badge, buttonClass, cx } from "./ui";

const CHUNK = 25;
const SHOWN = 200;

type Phase = { kind: "edit" } | { kind: "importing"; done: number; total: number } | { kind: "done"; result: LeadImportResult };

/** Paste/upload → check columns → preview (new vs update) → import. Everything before "Import" is a dry run. */
export function LeadImport() {
  const [text, setText] = useState("");
  const [fileError, setFileError] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "edit" });
  const [error, setError] = useState("");

  const table = useMemo(() => parseDelimited(text), [text]);
  const headers = useMemo(() => table[0] ?? [], [table]);
  const body = useMemo(() => table.slice(1), [table]);
  const headerKey = headers.join("\u0001");

  const [mapping, setMapping] = useState<Array<LeadImportField | "">>([]);
  const [mappingKey, setMappingKey] = useState("");
  if (mappingKey !== headerKey) {
    setMappingKey(headerKey);
    setMapping(guessLeadMapping(headers));
  }

  const rows = useMemo(() => applyLeadMapping(body, mapping), [body, mapping]);
  const tooMany = rows.length > MAX_LEAD_IMPORT_ROWS;
  const hasName = mapping.includes("name");

  const [preview, setPreview] = useState<{ key: string; rows: LeadImportPreviewRow[] } | null>(null);
  const [checking, startCheck] = useTransition();
  const inputKey = JSON.stringify(rows);
  useEffect(() => {
    if (rows.length === 0 || tooMany || !hasName) return;
    const t = setTimeout(() => {
      startCheck(async () => {
        const res = await previewLeadImportAction(rows);
        if (res.error) setError(res.error);
        else {
          setError("");
          setPreview({ key: inputKey, rows: res.rows ?? [] });
        }
      });
    }, 350);
    return () => clearTimeout(t);
    // inputKey captures rows
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputKey, tooMany, hasName]);

  const current = preview?.key === inputKey ? preview.rows : null;
  const counts = useMemo(() => {
    const c = { new: 0, update: 0, skip: 0, invalid: 0 };
    for (const r of current ?? []) c[r.status]++;
    return c;
  }, [current]);
  const toImport = current ? rows.filter((_, i) => current[i]?.status === "new" || current[i]?.status === "update") : [];

  async function readFile(file: File | undefined) {
    setFileError("");
    if (!file) return;
    if (file.size > 2_000_000) return setFileError("That file is over 2 MB. Split it into smaller files.");
    try {
      setText(await file.text());
    } catch {
      setFileError("Couldn't read that file.");
    }
  }

  async function runImport() {
    if (!toImport.length) return;
    setError("");
    const total: LeadImportResult = { created: 0, updated: 0, failed: [] };
    setPhase({ kind: "importing", done: 0, total: toImport.length });
    for (let i = 0; i < toImport.length; i += CHUNK) {
      const res = await importLeadChunkAction(toImport.slice(i, i + CHUNK), i + CHUNK >= toImport.length);
      if (res.error || !res.result) {
        setError(`${res.error ?? "Import stopped."} ${i ? `The first ${i} rows were saved.` : "Nothing was saved."}`);
        setPhase({ kind: "edit" });
        return;
      }
      total.created += res.result.created;
      total.updated += res.result.updated;
      total.failed.push(...res.result.failed);
      setPhase({ kind: "importing", done: Math.min(i + CHUNK, toImport.length), total: toImport.length });
    }
    setPhase({ kind: "done", result: total });
  }

  if (phase.kind === "done") {
    const r = phase.result;
    return (
      <section className="max-w-xl rounded-xl border border-border bg-surface p-5" role="status">
        <h2 className="text-base font-semibold">Import finished</h2>
        <p className="mt-1 text-sm">
          {r.created} new lead{r.created === 1 ? "" : "s"}, {r.updated} updated{r.failed.length ? `, ${r.failed.length} couldn’t be saved` : ""}.
        </p>
        {r.failed.length > 0 && (
          <ul className="mt-2 list-inside list-disc text-sm text-danger">
            {r.failed.slice(0, 20).map((f, i) => <li key={i}>{f.name}: {f.error}</li>)}
          </ul>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/leads" className={buttonClass("primary")}>See leads</Link>
          <button type="button" className={buttonClass("secondary")} onClick={() => { setText(""); setPreview(null); setPhase({ kind: "edit" }); }}>Import another</button>
        </div>
      </section>
    );
  }

  const busy = phase.kind === "importing";

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:items-start">
      <div className="space-y-5">
        <section className="rounded-xl border border-border bg-surface p-4">
          <label htmlFor="li-text" className="text-sm font-semibold">Paste from Google Sheets</label>
          <p className="mb-2 mt-0.5 text-xs text-muted">Copy the rows including the header row, then paste here.</p>
          <textarea
            id="li-text"
            className="input min-h-40! font-mono text-xs"
            value={text}
            disabled={busy}
            onChange={(e) => setText(e.target.value)}
            placeholder={"name,city,instagram,google rating,google reviews\nPho 99,Richmond VA,@pho99rva,4.2,312"}
          />
          <div className="mt-3">
            <label htmlFor="li-file" className="label">…or upload a CSV</label>
            <input id="li-file" type="file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values" disabled={busy} onChange={(e) => readFile(e.target.files?.[0])} className="block w-full text-sm file:mr-3 file:min-h-11 file:rounded-lg file:border file:border-border file:bg-surface file:px-3 file:text-sm md:file:min-h-9" />
            {fileError && <p className="mt-1 text-xs text-danger">{fileError}</p>}
          </div>
        </section>

        {headers.length > 0 && (
          <section className="rounded-xl border border-border bg-surface p-4">
            <h2 className="text-sm font-semibold">Columns</h2>
            <p className="mb-3 mt-0.5 text-xs text-muted">We matched these automatically. Change any that look wrong.</p>
            <div className="space-y-2">
              {headers.map((h, i) => (
                <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-2">
                  <span className="truncate text-sm" title={h}>{h || <em className="text-muted">(blank)</em>}</span>
                  <select
                    aria-label={`Field for column ${h}`}
                    className="input"
                    value={mapping[i] ?? ""}
                    disabled={busy}
                    onChange={(e) => {
                      const v = e.target.value as LeadImportField | "";
                      setMapping((m) => m.map((x, j) => (j === i ? v : x === v && v ? "" : x)));
                    }}
                  >
                    <option value="">Skip</option>
                    {LEAD_IMPORT_FIELDS.map((f) => <option key={f} value={f}>{LEAD_FIELD_LABEL[f]}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      <section className="min-w-0 rounded-xl border border-border bg-surface p-4">
        <h2 className="text-sm font-semibold">Preview</h2>
        {rows.length === 0 ? (
          <p className="mt-1 text-sm text-muted">Paste or upload a sheet to see what will be imported. Columns like Website, Instagram, Google rating and reviews are picked up automatically.</p>
        ) : tooMany ? (
          <p className="mt-1 text-sm text-danger">That’s {rows.length} rows — import at most {MAX_LEAD_IMPORT_ROWS} at a time.</p>
        ) : !hasName ? (
          <p className="mt-1 text-sm text-danger">Pick which column has the business name.</p>
        ) : (
          <>
            <div className="mb-3 mt-2 flex flex-wrap items-center gap-2 text-sm">
              {checking && !current ? <span className="text-muted">Checking…</span> : (
                <>
                  <Badge tone="ok">{counts.new} new</Badge>
                  <Badge tone="info">{counts.update} update</Badge>
                  {counts.skip > 0 && <Badge>{counts.skip} duplicate rows</Badge>}
                  {counts.invalid > 0 && <Badge tone="danger">{counts.invalid} can’t import</Badge>}
                </>
              )}
            </div>
            <ul className="max-h-[28rem] divide-y divide-border overflow-y-auto rounded-lg border border-border text-sm">
              {rows.slice(0, SHOWN).map((r, i) => {
                const p = current?.[i];
                return (
                  <li key={i} className="flex items-start justify-between gap-3 px-3 py-2">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{r.name || <em className="text-muted">No name</em>}</span>
                      <span className="block truncate text-xs text-muted">
                        {p?.status === "update" ? `Updates “${p.existingName}”` : p && "note" in p ? p.note : [r.city, r.instagramHandle, r.website].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    {p && (
                      <Badge tone={p.status === "new" ? "ok" : p.status === "update" ? "info" : p.status === "invalid" ? "danger" : "neutral"}>
                        {p.status === "new" ? "New" : p.status === "update" ? "Update" : p.status === "invalid" ? "Skip" : "Duplicate"}
                      </Badge>
                    )}
                  </li>
                );
              })}
            </ul>
            {rows.length > SHOWN && <p className="mt-1 text-xs text-muted">Showing the first {SHOWN} of {rows.length}.</p>}
          </>
        )}
        {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
        <div className="sticky-actions mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-surface/95 py-2 backdrop-blur">
          <button type="button" className={cx(buttonClass("primary"))} disabled={busy || checking || toImport.length === 0} onClick={runImport}>
            {busy ? `Importing ${phase.done} of ${phase.total}…` : toImport.length ? `Import ${toImport.length} lead${toImport.length === 1 ? "" : "s"}` : "Import"}
          </button>
          <span className="text-xs text-muted">Existing leads only get new info filled in — nothing is blanked out.</span>
        </div>
      </section>
    </div>
  );
}
