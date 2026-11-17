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
import { Card, Status, buttonClass, cx, formatNumber, type Tone } from "./ui";

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
    <div className="g-split">
      {/* Left: input + options */}
      <div>
        <section className="sec">
          <header className="sec-head">
            <label htmlFor="imp-text" className="title">Paste from Google Sheets</label>
          </header>
          <p className="sec-note">Copy the rows including the header row, then paste here.</p>
          <textarea
            id="imp-text"
            className="input min-h-40! font-mono text-sm"
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
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="meta">or</span>
            <label className={cx(buttonClass("secondary", "sm"), "cursor-pointer focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-text")}>
              Upload a .csv
              <input type="file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values" className="sr-only" disabled={busy} onChange={(e) => { void readFile(e.target.files?.[0]); e.target.value = ""; }} />
            </label>
            {fileName && <span className="meta min-w-0 truncate">{fileName}</span>}
          </div>
          {fileError && <p role="alert" className="status is-danger is-small mt-2 whitespace-normal">{fileError}</p>}
        </section>

        {ready && (
          <ColumnMapping headers={headers} mapping={mapping} onChange={setMapping} hasKey={hasKey} disabled={busy} />
        )}

        {ready && (
          <Card title="Start outreach too?">
            <p className="meta mb-4">Optional. Adds everyone to a business’s pipeline as “Sourced”. Do-not-contact creators are always left out.</p>
            <div className="grid gap-4">
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
          </Card>
        )}
      </div>

      {/* Right: preview + the one primary action */}
      <section className="sec min-w-0" aria-labelledby="imp-preview-h">
        <header className="sec-head">
          <h2 id="imp-preview-h" className="title">Preview</h2>
          {current && (
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1" aria-live="polite">
              <Status tone="ok" small>{counts.new} new</Status>
              <Status tone="info" small>{counts.update} will update</Status>
              {counts.skip > 0 && <Status small>{counts.skip} repeated</Status>}
              {counts.invalid > 0 && <Status tone="danger" small>{counts.invalid} can’t import</Status>}
            </div>
          )}
        </header>
        <div className="sec-body">
          {!ready ? (
            <div className="empty">
              <p>Nothing pasted yet</p>
              <p>Paste rows or upload a file to see what will be imported. Nothing is saved until you press Import.</p>
            </div>
          ) : tooMany ? (
            <p className="status is-danger whitespace-normal">That’s {rows.length} rows. Import at most {MAX_IMPORT_ROWS} at a time.</p>
          ) : !hasKey ? (
            <p className="status is-warn whitespace-normal">Pick which column is the Instagram handle, TikTok handle or email. That’s how we spot creators you already have.</p>
          ) : !current ? (
            <p className="meta py-6">{checking ? "Checking against your roster…" : "Preparing preview…"}</p>
          ) : (
            <PreviewTable rows={rows} preview={current} />
          )}
          {error && <p role="alert" className="notice mt-3"><span className="status is-danger">{error}</span></p>}
        </div>
        {ready && hasKey && !tooMany && (
          <div className="g-bar sticky-actions mt-4">
            <button type="button" className={buttonClass("secondary")} disabled={busy || checking || !current || toImport.length === 0} onClick={runImport}>
              {busy ? `Importing… ${phase.done}/${phase.total}` : `Import ${toImport.length} creator${toImport.length === 1 ? "" : "s"}`}
            </button>
            {current && clientId && !busy && toImport.length > 0 && (
              <span className="meta">and start outreach for {clients.find((c) => c.id === clientId)?.label}</span>
            )}
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
    <details className="group sec g-fold" open={!hasKey || undefined}>
      <summary className="sec-head">
        <span className="min-w-0">
          <span className="title block">Columns</span>
          <span className="meta block truncate">
            {matched.length ? `Matched ${matched.map((f) => FIELD_LABEL[f]).join(", ")}` : "No columns matched yet"}
          </span>
        </span>
        <span className="link-quiet shrink-0 group-open:hidden">Change</span>
        <span className="link-quiet hidden shrink-0 group-open:inline">Done</span>
      </summary>
      <ul className="list">
        {headers.map((h, i) => (
          <li key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-3 py-2">
            <label htmlFor={`map-${i}`} className="truncate" title={h}>{h || <span className="text-muted">Column {i + 1}</span>}</label>
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

const STATUS: Record<ImportPreviewRow["status"], { label: string; tone: Tone }> = {
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
      {/* Phones: one row per line of the sheet */}
      <ul className="list md:hidden">
        {shown.map((r, i) => {
          const p = preview[i];
          if (!p) return null;
          const s = STATUS[p.status];
          const facts = [handle(r.instagramHandle), handle(r.tiktokHandle), r.email, followers(r)].filter(Boolean);
          return (
            <li key={i} className={cx("g-row", (p.status === "skip" || p.status === "invalid") && "is-muted")}>
              <span className="row-title truncate">{"name" in p ? p.name : r.name || `Row ${i + 2}`}</span>
              <span className="end"><Status tone={s.tone} small>{s.label}</Status></span>
              {facts.length > 0 && <p className="more truncate">{facts.join(" · ")}</p>}
              {(p.status === "update" && p.existingName !== p.name) && <p className="more">Updates {p.existingName}</p>}
              {p.note && <p className={cx("more", p.status === "invalid" && "text-danger!")}>{p.note}</p>}
            </li>
          );
        })}
      </ul>

      {/* Tablet/desktop: a table that scrolls inside its own region */}
      <div className="g-scroll relative hidden max-h-[60vh] md:block" tabIndex={0} role="region" aria-label="Rows to import">
        <table className="g-table min-w-[44rem] text-sm">
          <thead>
            <tr>
              <th scope="col">Row</th>
              <th scope="col">Status</th>
              <th scope="col">Name</th>
              <th scope="col">Instagram</th>
              <th scope="col">TikTok</th>
              <th scope="col">Email</th>
              <th scope="col">Followers</th>
              <th scope="col">Note</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => {
              const p = preview[i];
              if (!p) return null;
              const s = STATUS[p.status];
              return (
                <tr key={i} className={cx((p.status === "skip" || p.status === "invalid") && "text-muted")}>
                  <td className="tabular-nums text-muted">{i + 2}</td>
                  <td><Status tone={s.tone} small>{s.label}</Status></td>
                  <td className="max-w-48 truncate font-medium">{"name" in p ? p.name : r.name}</td>
                  <td className="max-w-40 truncate">{handle(r.instagramHandle)}</td>
                  <td className="max-w-40 truncate">{handle(r.tiktokHandle)}</td>
                  <td className="max-w-48 truncate">{r.email}</td>
                  <td className="whitespace-nowrap tabular-nums">{followers(r)}</td>
                  <td className={p.status === "invalid" ? "text-danger" : "text-muted"}>
                    {p.status === "update" && p.existingName !== p.name ? `Updates ${p.existingName}${p.note ? ". " : ""}` : ""}
                    {p.note}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length > SHOWN && <p className="meta mt-2">Showing the first {SHOWN} of {rows.length} rows. All of them will be imported.</p>}
      <p className="meta mt-3">Existing creators are matched by Instagram handle, then TikTok handle, then email. Empty cells never erase what’s already saved.</p>
    </>
  );
}

function Done({ result, outreachFor, onAgain }: { result: ImportResult; outreachFor?: string; onAgain: () => void }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <section className="sec mt-0 max-w-2xl">
      <header className="sec-head">
        <h2 ref={ref} tabIndex={-1} className="title outline-none">Import finished</h2>
      </header>
      <p className="sec-body">
        Added {result.created}, updated {result.updated}.
        {outreachFor ? ` Started outreach with ${result.outreachStarted} for ${outreachFor}.` : ""}
      </p>
      {result.failed.length > 0 && (
        <div className="notice mt-4 block">
          <p className="status is-danger">{result.failed.length} couldn’t be saved:</p>
          <ul className="meta mt-1 list-disc pl-5">
            {result.failed.slice(0, 20).map((f, i) => <li key={i}>{f.name}: {f.error}</li>)}
          </ul>
        </div>
      )}
      <div className="mt-6 flex flex-wrap gap-2">
        <Link href="/creators" className={buttonClass("secondary")}>See creators</Link>
        <button type="button" className={buttonClass("secondary")} onClick={onAgain}>Import more</button>
      </div>
    </section>
  );
}
