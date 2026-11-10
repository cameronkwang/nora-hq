"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { importTasks, previewTaskImport } from "@/app/(app)/tasks/actions";
import type { ImportPreview } from "@/app/(app)/tasks/csv";
import { Button, PlatformTag, cx, humanize } from "./ui";

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
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="flex flex-col gap-3">
          <label className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border px-3 py-4 text-sm font-medium hover:bg-surface-2">
            <svg viewBox="0 0 16 16" aria-hidden className="size-4" fill="none" stroke="currentColor" strokeWidth={1.6}>
              <path d="M8 10.5V2.5M5 5.5l3-3 3 3M2.5 10.5v2a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {fileName ? `Loaded ${fileName} — choose another` : "Choose a CSV file"}
            <input type="file" accept=".csv,text/csv,text/plain" className="sr-only" onChange={(e) => onFile(e.currentTarget.files?.[0])} />
          </label>

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
            <p className="mt-1 text-xs text-muted">
              First row is headers: <code>title</code> (required), <code>business</code>, <code>due</code>, <code>assignee</code>, <code>platform</code>, <code>details</code>. Business can be its name, “name · location”, or id. Up to 300 rows.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant={preview ? "secondary" : "primary"} disabled={!csv.trim() || checking} onClick={() => check(csv)}>
              {checking ? "Checking…" : preview ? "Check again" : "Check rows"}
            </Button>
            {!csv && (
              <button type="button" onClick={() => setCsv(SAMPLE)} className="px-2 text-sm text-muted underline hover:text-text pointer-coarse:min-h-11">
                Use an example
              </button>
            )}
          </div>
        </div>
      </div>

      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

      {preview?.fileError && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{preview.fileError}</p>}

      {preview && !preview.fileError && (
        <section aria-label="Preview" className="rounded-xl border border-border bg-surface">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold">
              {valid} ready{invalid > 0 && <span className="text-danger"> · {invalid} with problems (skipped)</span>}
            </h2>
            {preview.ignoredHeaders.length > 0 && <p className="text-xs text-muted">Ignored columns: {preview.ignoredHeaders.join(", ")}</p>}
          </header>
          <ul className="max-h-[28rem] divide-y divide-border overflow-y-auto">
            {preview.rows.map((r) => {
              const bad = r.errors.length > 0;
              return (
                <li key={r.line} className={cx("flex gap-3 px-4 py-2.5 text-sm", bad && "bg-danger-soft/50")}>
                  <span className="w-8 shrink-0 pt-0.5 text-right text-xs tabular-nums text-muted">{r.line}</span>
                  <div className="min-w-0 flex-1">
                    <p className={cx("break-words font-medium", !r.title && "italic text-muted")}>{r.title || "No title"}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                      <span>{r.business || "No business"}</span>
                      {r.dueDate && <span>Due {r.dueDate}</span>}
                      {r.assignee !== "unassigned" && <span>{humanize(r.assignee)}</span>}
                      <PlatformTag platform={r.platform} />
                      {r.details && <span className="max-w-full truncate">{r.details}</span>}
                    </p>
                    {bad && (
                      <ul className="mt-1 text-xs text-danger">
                        {r.errors.map((e) => (
                          <li key={e}>{e}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <span aria-label={bad ? "Has problems" : "Ready"} className={cx("shrink-0 pt-0.5 text-xs font-semibold", bad ? "text-danger" : "text-ok")}>
                    {bad ? "Skip" : "OK"}
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="sticky-actions border-t border-border bg-surface p-3">
            <Button type="button" variant="primary" disabled={valid === 0 || importing || checking} onClick={doImport} className="w-full sm:w-auto">
              {importing ? "Importing…" : `Import ${valid} task${valid === 1 ? "" : "s"}`}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
