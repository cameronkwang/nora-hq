"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  FIELD_LABEL,
  IMPORT_FIELDS,
  MAX_IMPORT_ROWS,
  applyMapping,
  guessMapping,
  parseDelimited,
  parseFollowerCount,
  type ImportField,
  type RawImportRow,
} from "@/app/(app)/creators/import/parse";
import { importChunkAction, previewImportAction, type ImportOutreachChoice } from "@/app/(app)/creators/import/actions";
import type { ImportPreviewRow, ImportResult } from "@/lib/ops-creators";
import type { OutreachChannel } from "@/lib/schema";
import { Badge, buttonClass, cx, formatNumber } from "./ui";

const CHANNELS: Array<[OutreachChannel, string]> = [["instagram_dm", "Instagram DM"], ["tiktok_dm", "TikTok DM"], ["email", "Email"]];
const CHUNK = 25;
const SHOWN = 200;

type Phase = { kind: "edit" } | { kind: "importing"; done: number; total: number } | { kind: "done"; result: ImportResult; outreachFor?: string };

/** Paste/upload → map columns → preview → import. Everything before "Import" is a dry run. */
export function CreatorImport({ clients }: { clients: Array<{ id: string; label: string }> }) {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileError, setFileError] = useState("");
  const [clientId, setClientId] = useState("");
  const [channel, setChannel] = useState<OutreachChannel>("instagram_dm");
  const [phase, setPhase] = useState<Phase>({ kind: "edit" });
  const [error, setError] = useState("");

  const table = useMemo(() => parseDelimited(text), [text]);
  const headers = useMemo(() => table[0] ?? [], [table]);
  const body = useMemo(() => table.slice(1), [table]);
  const headerKey = headers.join("\u0001");

  // Re-guess the mapping whenever the header row changes; manual picks stick until then.
  const [mapping, setMapping] = useState<Array<ImportField | "">>([]);
  const [mappingKey, setMappingKey] = useState("");
  if (mappingKey !== headerKey) {
    setMappingKey(headerKey);
    setMapping(guessMapping(headers));
  }

  const rows = useMemo(() => applyMapping(body, mapping), [body, mapping]);
  const outreach: ImportOutreachChoice = clientId ? { clientId, channel } : null;
  const tooMany = rows.length > MAX_IMPORT_ROWS;
  const hasKey = mapping.some((m) => m === "instagramHandle" || m === "tiktokHandle" || m === "email");

  // Debounced dry run on the server (it knows who's already in the roster).
  const [preview, setPreview] = useState<{ key: string; rows: ImportPreviewRow[] } | null>(null);
  const [checking, startCheck] = useTransition();
  const inputKey = JSON.stringify([rows, outreach]);
  useEffect(() => {
    if (rows.length === 0 || tooMany || !hasKey) return;
    const t = setTimeout(() => {
      startCheck(async () => {
        const res = await previewImportAction(rows, outreach);
        if (res.error) setError(res.error);
        else {
          setError("");
          setPreview({ key: inputKey, rows: res.rows ?? [] });
        }
      });
    }, 350);
    return () => clearTimeout(t);
    // inputKey captures rows + outreach
  }, [inputKey, tooMany, hasKey]);

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
      setFileName(file.name);
    } catch {
      setFileError("Couldn't read that file.");
    }
  }

  async function runImport() {
    if (!toImport.length) return;
    setError("");
    const total: ImportResult = { created: 0, updated: 0, outreachStarted: 0, failed: [] };
    setPhase({ kind: "importing", done: 0, total: toImport.length });
    for (let i = 0; i < toImport.length; i += CHUNK) {
      const chunk = toImport.slice(i, i + CHUNK);
      const res = await importChunkAction(chunk, outreach, i + CHUNK >= toImport.length);
      if (res.error || !res.result) {
        setError(`${res.error ?? "Import stopped."} ${i ? `The first ${i} rows were saved.` : "Nothing was saved."}`);
        setPhase({ kind: "edit" });
        return;
      }
      total.created += res.result.created;
      total.updated += res.result.updated;
      total.outreachStarted += res.result.outreachStarted;
      total.failed.push(...res.result.failed);
      setPhase({ kind: "importing", done: Math.min(i + CHUNK, toImport.length), total: toImport.length });
    }
    setPhase({ kind: "done", result: total, outreachFor: clients.find((c) => c.id === clientId)?.label });
  }

  function reset() {
    setText("");
    setFileName("");
    setPreview(null);
    setPhase({ kind: "edit" });
  }

  if (phase.kind === "done") return <Done result={phase.result} outreachFor={phase.outreachFor} onAgain={reset} />;

  const busy = phase.kind === "importing";
  const ready = rows.length > 0;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:items-start">
      {/* Left: input + options */}
      <div className="space-y-5">
        <section className="rounded-xl border border-border bg-surface p-4">
          <label htmlFor="imp-text" className="text-sm font-semibold">Paste from Google Sheets</label>
          <p className="mb-2 mt-0.5 text-xs text-muted">Copy the rows including the header row, then paste here.</p>
          <textarea
            id="imp-text"
            className="input min-h-40! font-mono text-xs"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setFileName("");
            }}
            placeholder={"Name\tInstagram\tFollowers\nJess Eats\t@jesseats\t12.5k"}
            spellCheck={false}
            autoCapitalize="none"
            autoComplete="off"
            disabled={busy}
          />
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted">or</span>
            <label className={cx(buttonClass("secondary", "sm"), "cursor-pointer focus-within:outline-2 focus-within:outline-accent")}>
              Upload a .csv
              <input type="file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values" className="sr-only" disabled={busy} onChange={(e) => { void readFile(e.target.files?.[0]); e.target.value = ""; }} />
            </label>
            {fileName && <span className="min-w-0 truncate text-xs text-muted">{fileName}</span>}
          </div>
          {fileError && <p role="alert" className="mt-2 text-xs text-danger">{fileError}</p>}
        </section>

        {ready && (
          <ColumnMapping headers={headers} mapping={mapping} onChange={setMapping} hasKey={hasKey} disabled={busy} />
        )}

        {ready && (
          <section className="rounded-xl border border-border bg-surface p-4">
            <h2 className="text-sm font-semibold">Start outreach too?</h2>
            <p className="mb-3 mt-0.5 text-xs text-muted">Optional. Adds everyone to a business’s pipeline as “Sourced”. Do-not-contact creators are always left out.</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <div>
                <label className="label" htmlFor="imp-client">Business</label>
                <select id="imp-client" className="input" value={clientId} onChange={(e) => setClientId(e.target.value)} disabled={busy}>
                  <option value="">No, just add them</option>
                  {clients.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </div>
              {clientId && (
                <div>
                  <label className="label" htmlFor="imp-channel">Channel</label>
                  <select id="imp-channel" className="input" value={channel} onChange={(e) => setChannel(e.target.value as OutreachChannel)} disabled={busy}>
                    {CHANNELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
              )}
            </div>
          </section>
        )}
      </div>

      {/* Right: preview + the one primary action */}
      <section className="min-w-0 rounded-xl border border-border bg-surface" aria-labelledby="imp-preview-h">
        <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <h2 id="imp-preview-h" className="mr-auto text-sm font-semibold">Preview</h2>
          {current && (
            <div className="flex flex-wrap gap-1.5" aria-live="polite">
              <Badge tone="ok">{counts.new} new</Badge>
              <Badge tone="info">{counts.update} will update</Badge>
              {counts.skip > 0 && <Badge>{counts.skip} repeated</Badge>}
              {counts.invalid > 0 && <Badge tone="danger">{counts.invalid} can’t import</Badge>}
            </div>
          )}
        </header>
        <div className="p-4">
          {!ready ? (
            <p className="py-8 text-center text-sm text-muted">Paste rows or upload a file to see what will be imported. Nothing is saved until you press Import.</p>
          ) : tooMany ? (
            <p className="text-sm text-danger">That’s {rows.length} rows. Import at most {MAX_IMPORT_ROWS} at a time.</p>
          ) : !hasKey ? (
            <p className="text-sm text-warn">Pick which column is the Instagram handle, TikTok handle or email — that’s how we spot creators you already have.</p>
          ) : !current ? (
            <p className="py-8 text-center text-sm text-muted">{checking ? "Checking against your roster…" : "Preparing preview…"}</p>
          ) : (
            <PreviewTable rows={rows} preview={current} />
          )}
          {error && <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        </div>
        {ready && hasKey && !tooMany && (
          <div className="sticky-actions border-t border-border bg-surface px-4 py-3 rounded-b-xl">
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className={buttonClass("primary")} disabled={busy || checking || !current || toImport.length === 0} onClick={runImport}>
                {busy ? `Importing… ${phase.done}/${phase.total}` : `Import ${toImport.length} creator${toImport.length === 1 ? "" : "s"}`}
              </button>
              {current && clientId && !busy && toImport.length > 0 && (
                <span className="text-xs text-muted">and start outreach for {clients.find((c) => c.id === clientId)?.label}</span>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function ColumnMapping({
  headers,
  mapping,
  onChange,
  hasKey,
  disabled,
}: {
  headers: string[];
  mapping: Array<ImportField | "">;
  onChange: (m: Array<ImportField | "">) => void;
  hasKey: boolean;
  disabled: boolean;
}) {
  const matched = mapping.filter(Boolean) as ImportField[];
  return (
    <details className="group rounded-xl border border-border bg-surface" open={!hasKey || undefined}>
      <summary className="no-marker flex cursor-pointer items-center justify-between gap-2 px-4 py-3 min-h-11">
        <span className="min-w-0">
          <span className="block text-sm font-semibold">Columns</span>
          <span className="block truncate text-xs text-muted">
            {matched.length ? `Matched ${matched.map((f) => FIELD_LABEL[f]).join(", ")}` : "No columns matched yet"}
          </span>
        </span>
        <span className="shrink-0 text-sm text-accent group-open:hidden">Change</span>
        <span className="hidden shrink-0 text-sm text-accent group-open:inline">Done</span>
      </summary>
      <ul className="grid gap-3 border-t border-border p-4">
        {headers.map((h, i) => (
          <li key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-3">
            <label htmlFor={`map-${i}`} className="truncate text-sm" title={h}>{h || <span className="text-muted">Column {i + 1}</span>}</label>
            <select
              id={`map-${i}`}
              className="input"
              value={mapping[i] ?? ""}
              disabled={disabled}
              onChange={(e) => {
                const f = e.target.value as ImportField | "";
                // A field can only come from one column: picking it here frees it elsewhere.
                onChange(headers.map((_, j) => (j === i ? f : mapping[j] === f ? "" : (mapping[j] ?? ""))));
              }}
            >
              <option value="">Ignore</option>
              {IMPORT_FIELDS.map((f) => <option key={f} value={f}>{FIELD_LABEL[f]}</option>)}
            </select>
          </li>
        ))}
      </ul>
    </details>
  );
}

const STATUS: Record<ImportPreviewRow["status"], { label: string; tone: "ok" | "info" | "neutral" | "danger" }> = {
  new: { label: "New", tone: "ok" },
  update: { label: "Update", tone: "info" },
  skip: { label: "Repeated", tone: "neutral" },
  invalid: { label: "Can’t import", tone: "danger" },
};

function PreviewTable({ rows, preview }: { rows: RawImportRow[]; preview: ImportPreviewRow[] }) {
  const shown = rows.slice(0, SHOWN);
  const handle = (s?: string) => (s ? `@${s.replace(/^@/, "").replace(/^https?:\/\/(www\.)?(instagram|tiktok)\.com\/@?/i, "").replace(/[/?].*$/, "")}` : "");
  const followers = (r: RawImportRow) => {
    const ig = parseFollowerCount(r.instagramFollowers), tt = parseFollowerCount(r.tiktokFollowers);
    return [ig != null && !Number.isNaN(ig) ? `IG ${formatNumber(ig)}` : "", tt != null && !Number.isNaN(tt) ? `TT ${formatNumber(tt)}` : ""].filter(Boolean).join(" · ");
  };
  return (
    <>
      {/* Phones: stacked cards */}
      <ul className="divide-y divide-border md:hidden">
        {shown.map((r, i) => {
          const p = preview[i];
          if (!p) return null;
          const s = STATUS[p.status];
          return (
            <li key={i} className={cx("py-2.5", (p.status === "skip" || p.status === "invalid") && "opacity-70")}>
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-medium">{"name" in p ? p.name : r.name || `Row ${i + 2}`}</span>
                <Badge tone={s.tone}>{s.label}</Badge>
              </div>
              <p className="mt-0.5 truncate text-xs text-muted">{[handle(r.instagramHandle), handle(r.tiktokHandle), r.email, followers(r)].filter(Boolean).join(" · ")}</p>
              {(p.status === "update" && p.existingName !== p.name) && <p className="mt-0.5 text-xs text-muted">Updates {p.existingName}</p>}
              {p.note && <p className={cx("mt-0.5 text-xs", p.status === "invalid" ? "text-danger" : "text-muted")}>{p.note}</p>}
            </li>
          );
        })}
      </ul>

      {/* Tablet/desktop: table that scrolls inside its own box */}
      <div className="relative hidden max-h-[60vh] overflow-auto md:block" tabIndex={0} role="region" aria-label="Rows to import">
        <table className="w-full min-w-[44rem] text-left text-sm">
          <thead className="sticky top-0 bg-surface text-xs text-muted">
            <tr className="border-b border-border">
              <th scope="col" className="py-2 pr-3 font-medium">Row</th>
              <th scope="col" className="py-2 pr-3 font-medium">Status</th>
              <th scope="col" className="py-2 pr-3 font-medium">Name</th>
              <th scope="col" className="py-2 pr-3 font-medium">Instagram</th>
              <th scope="col" className="py-2 pr-3 font-medium">TikTok</th>
              <th scope="col" className="py-2 pr-3 font-medium">Email</th>
              <th scope="col" className="py-2 pr-3 font-medium">Followers</th>
              <th scope="col" className="py-2 font-medium">Note</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {shown.map((r, i) => {
              const p = preview[i];
              if (!p) return null;
              const s = STATUS[p.status];
              return (
                <tr key={i} className={cx((p.status === "skip" || p.status === "invalid") && "text-muted")}>
                  <td className="py-2 pr-3 tabular-nums text-muted">{i + 2}</td>
                  <td className="py-2 pr-3"><Badge tone={s.tone}>{s.label}</Badge></td>
                  <td className="max-w-48 truncate py-2 pr-3 font-medium">{"name" in p ? p.name : r.name}</td>
                  <td className="max-w-40 truncate py-2 pr-3">{handle(r.instagramHandle)}</td>
                  <td className="max-w-40 truncate py-2 pr-3">{handle(r.tiktokHandle)}</td>
                  <td className="max-w-48 truncate py-2 pr-3">{r.email}</td>
                  <td className="whitespace-nowrap py-2 pr-3 tabular-nums">{followers(r)}</td>
                  <td className={cx("py-2 text-xs", p.status === "invalid" ? "text-danger" : "text-muted")}>
                    {p.status === "update" && p.existingName !== p.name ? `Updates ${p.existingName}${p.note ? ". " : ""}` : ""}
                    {p.note}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length > SHOWN && <p className="mt-2 text-xs text-muted">Showing the first {SHOWN} of {rows.length} rows. All of them will be imported.</p>}
      <p className="mt-3 text-xs text-muted">Existing creators are matched by Instagram handle, then TikTok handle, then email. Empty cells never erase what’s already saved.</p>
    </>
  );
}

function Done({ result, outreachFor, onAgain }: { result: ImportResult; outreachFor?: string; onAgain: () => void }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <section className="rounded-xl border border-border bg-surface p-6">
      <h2 ref={ref} tabIndex={-1} className="text-lg font-semibold outline-none">Import finished</h2>
      <p className="mt-1 text-sm text-muted">
        Added {result.created}, updated {result.updated}.
        {outreachFor ? ` Started outreach with ${result.outreachStarted} for ${outreachFor}.` : ""}
      </p>
      {result.failed.length > 0 && (
        <div className="mt-4 rounded-lg bg-danger-soft p-3 text-sm text-danger">
          <p className="font-medium">{result.failed.length} couldn’t be saved:</p>
          <ul className="mt-1 list-disc pl-5">
            {result.failed.slice(0, 20).map((f, i) => <li key={i}>{f.name}: {f.error}</li>)}
          </ul>
        </div>
      )}
      <div className="mt-5 flex flex-wrap gap-2">
        <Link href="/creators" className={buttonClass("primary")}>See creators</Link>
        <button type="button" className={buttonClass("secondary")} onClick={onAgain}>Import more</button>
      </div>
    </section>
  );
}
