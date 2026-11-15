"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { importTasks, previewTaskImport } from "@/app/(app)/tasks/actions";
import type { ImportPreview } from "@/app/(app)/tasks/csv";
import { Button, PlatformTag, Status, buttonClass, cx, humanize } from "./ui";

const sample = (business: string, due: string) => `title,business,due,assignee,platform,details
Film 3 reels,${business},${due},nora,instagram,Focus on the new menu item
Reply to new Google reviews,${business},,claude,google,`;

/** Paste or upload → check (server validates every row) → import the valid rows. */
export function TaskImport({ exampleBusiness, exampleDue }: { exampleBusiness: string; exampleDue: string }) {
  const SAMPLE = sample(exampleBusiness.includes(",") ? `"${exampleBusiness}"` : exampleBusiness, exampleDue);
  const router = useRouter();
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, startCheck] = useTransition();
  const [importing, startImport] = useTransition();

  const check = (text: string) =>
    startCheck(async () => {
      setError(null);
      setPreview(await previewTaskImport(text));
    });

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 512 * 1024) {
      setError("That file is too big (max 512 KB).");
      return;
    }
    const text = await file.text();
    setFileName(file.name);
    setCsv(text);
    check(text);
  };

  const valid = preview?.rows.filter((r) => r.errors.length === 0).length ?? 0;
  const invalid = (preview?.rows.length ?? 0) - valid;

  const doImport = () =>
    startImport(async () => {
      setError(null);
      const r = await importTasks(csv);
      if (r.ok) router.push(`/tasks?imported=${r.count ?? 0}`);
      else setError(r.error);
    });

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          {/* The file input is hidden inside a secondary button; focus shows on the button. */}
          <label className={cx(buttonClass("secondary"), "cursor-pointer has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-text")}>
            <svg viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth={1.6}>
              <path d="M8 10.5V2.5M5 5.5l3-3 3 3M2.5 10.5v2a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {fileName ? "Choose another file" : "Choose a CSV file"}
            <input type="file" accept=".csv,text/csv,text/plain" className="sr-only" onChange={(e) => onFile(e.currentTarget.files?.[0])} />
          </label>
          {fileName && <span className="meta min-w-0 break-all">Loaded {fileName}</span>}
        </div>

          <div>
            <label htmlFor="csv-text" className="label">…or paste it here</label>
            <textarea
              id="csv-text"
              value={csv}
              onChange={(e) => {
                setCsv(e.currentTarget.value);
                setPreview(null);
                setFileName(null);
              }}
              rows={7}
              spellCheck={false}
              placeholder={SAMPLE}
              className="input font-mono"
            />
            <p className="hint">
              First row is headers: <code>title</code> (required), <code>business</code>, <code>due</code>, <code>assignee</code>, <code>platform</code>, <code>details</code>. Business can be its name, “name · location”, or id. Up to 300 rows.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant={preview ? "secondary" : "primary"} disabled={!csv.trim() || checking} onClick={() => check(csv)}>
              {checking ? "Checking…" : preview ? "Check again" : "Check rows"}
            </Button>
            {!csv && (
              <button type="button" onClick={() => setCsv(SAMPLE)} className={buttonClass("ghost")}>
                Use an example
              </button>
            )}
          </div>
      </div>

      {error && (
        <p role="alert" className="notice mt-6">
          <Status tone="danger" className="whitespace-normal">{error}</Status>
        </p>
      )}

      {preview?.fileError && (
        <p role="alert" className="notice mt-6">
          <Status tone="danger" className="whitespace-normal">{preview.fileError}</Status>
        </p>
      )}

      {preview && !preview.fileError && (
        <section aria-label="Preview" className="sec mt-8 md:mt-10">
          <header className="sec-head flex-wrap">
            <h2 className="title">
              {valid} ready{invalid > 0 && <span className="meta">{invalid} with problems (skipped)</span>}
            </h2>
            {preview.ignoredHeaders.length > 0 && <p className="meta">Ignored columns: {preview.ignoredHeaders.join(", ")}</p>}
          </header>
          <ul className="list max-h-[28rem] overflow-y-auto">
            {preview.rows.map((r) => {
              const bad = r.errors.length > 0;
              return (
                <li key={r.line} className="import-row">
                  <span className="line meta num">{r.line}</span>
                  <div className="main">
                    <p className={cx("row-title", !r.title && "is-plain italic text-muted")}>{r.title || "No title"}</p>
                    <p className="meta flex flex-wrap items-baseline gap-x-3">
                      <span>{r.business || "No business"}</span>
                      {r.dueDate && <span>Due {r.dueDate}</span>}
                      {r.assignee !== "unassigned" && <span>{humanize(r.assignee)}</span>}
                      <PlatformTag platform={r.platform} inherit />
                      {r.details && <span className="max-w-full truncate">{r.details}</span>}
                    </p>
                    {bad && (
                      <ul className="mt-1 text-sm text-danger">
                        {r.errors.map((e) => (
                          <li key={e}>{e}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <span aria-label={bad ? "Has problems" : "Ready"} className="shrink-0">
                    <Status tone={bad ? "danger" : "ok"} small>{bad ? "Skip" : "OK"}</Status>
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="sticky-actions border-t border-border bg-bg py-3">
            <Button type="button" variant="primary" disabled={valid === 0 || importing || checking} onClick={doImport} className="w-full sm:w-auto">
              {importing ? "Importing…" : `Import ${valid} task${valid === 1 ? "" : "s"}`}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
