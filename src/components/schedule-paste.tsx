"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { importScheduleAction } from "@/app/(app)/calendar/schedule-actions";
import type { ImportResult } from "@/lib/ops-schedule";
import { ScheduleSheet } from "./schedule-sheet";
import { Button, Status, Tag, buttonClass, cx } from "./ui";

const EXAMPLE = `November
1. 11/04 | Antonelli’s - FREE 📸
2. 11/12 | Issho 📸
3. 11/XX | Bloom - FREE`;

const day = (d: string | null) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : "No set day");
const monthShort = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, 15)).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
};

/**
 * "Paste schedule": Nora's list from her notes → Preview (what's new, what changes, what's skipped and why)
 * → Import. Amounts, (Check)/(Zelle) and 🚩 are dropped by the parser and never shown here.
 */
export function SchedulePaste() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [checking, startCheck] = useTransition();
  const [importing, startImport] = useTransition();

  const reset = () => {
    setText("");
    setPreview(null);
    setError(null);
    setDone(null);
  };
  const close = () => {
    setOpen(false);
    reset();
  };

  const check = () =>
    startCheck(async () => {
      setError(null);
      const r = await importScheduleAction(text, true);
      if (r.ok) setPreview(r.result);
      else setError(r.error);
    });

  const doImport = () =>
    startImport(async () => {
      setError(null);
      const r = await importScheduleAction(text, false);
      if (!r.ok) return setError(r.error);
      setDone(`Done: ${r.result.add} added, ${r.result.update} updated.`);
      setPreview(null);
      router.refresh();
    });

  const changes = preview ? preview.add + preview.update : 0;
  const shown = preview ? [...preview.rows].sort((a, b) => order[a.action] - order[b.action]) : [];

  return (
    <>
      <button type="button" className={buttonClass("ghost", "sm")} onClick={() => setOpen(true)} aria-haspopup="dialog">
        {/* "Paste" on a phone, so the title keeps its actions on one line; the button is still "Paste schedule". */}
        <span>
          Paste<span className="max-md:sr-only"> schedule</span>
        </span>
      </button>
      <ScheduleSheet
        open={open}
        onClose={close}
        wide
        title="Paste Nora’s schedule"
        subtitle="Copy the list from your notes and paste it here. Dates, FREE and 📸 are kept; amounts and payment notes are left out."
      >
        {done ? (
          <div role="status" className="space-y-4">
            <p className="notice">
              <Status tone="ok" className="whitespace-normal text-text">{done}</Status>
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="primary" onClick={close}>Got it</Button>
              <Button type="button" onClick={reset}>Paste more</Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div>
              <label htmlFor="schedule-paste" className="label">Schedule</label>
              <textarea
                id="schedule-paste"
                value={text}
                onChange={(e) => {
                  setText(e.currentTarget.value);
                  setPreview(null);
                }}
                rows={preview ? 4 : 10}
                spellCheck={false}
                placeholder={EXAMPLE}
                className="input font-mono"
              />
              <p className="hint">One per line: <code>11/04 | Business</code>. Use <code>11/XX</code> when there&apos;s no set day. Pasting again updates; nothing is duplicated.</p>
            </div>

            {error && (
              <p role="alert" className="notice">
                <Status tone="danger" className="whitespace-normal">{error}</Status>
              </p>
            )}

            {!preview && (
              <div>
                <Button type="button" variant="primary" disabled={!text.trim() || checking} onClick={check}>
                  {checking ? "Reading…" : "Preview"}
                </Button>
              </div>
            )}

            {preview && (
              <section aria-label="Preview" className="mt-2">
                {/* The counts, each a dot and plain words, on the ink rule. */}
                <header className="paste-head">
                  <Status tone="ink" small>{preview.add} new</Status>
                  <Status tone="info" small>{preview.update} to update</Status>
                  <Status tone="neutral" small>{preview.unchanged} unchanged</Status>
                  {preview.skipped.length > 0 && <Status tone="warn" small>{preview.skipped.length} skipped</Status>}
                </header>
                <ul className="list max-h-[45dvh] overflow-y-auto border-t border-border">
                  {preview.skipped.map((s, i) => (
                    <li key={`skip-${i}`} className="paste-row">
                      <span className="what">
                        <Status tone="warn" small>Skipped</Status>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block break-words font-mono text-sm">{s.line || "(empty)"}</span>
                        <span className="meta block">{s.reason}</span>
                      </span>
                    </li>
                  ))}
                  {shown.map((r, i) => (
                    <li key={`${r.month}-${r.businessName}-${i}`} className={cx("paste-row", r.action === "unchanged" && "is-same")}>
                      <span className="what">
                        <Status tone={r.action === "add" ? "ink" : r.action === "update" ? "info" : "neutral"} small>
                          {r.action === "add" ? "New" : r.action === "update" ? "Update" : "Same"}
                        </Status>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-baseline gap-x-2">
                          <span className="font-medium">{r.businessName}</span>
                          {r.isFree && <Tag bare>Free</Tag>}
                          {r.needsReel && <span className="emoji" title="Reel to post">📸</span>}
                        </span>
                        <span className="meta block">
                          {monthShort(r.month)} · {day(r.date)}
                          {r.clientName && ` · ${r.clientName}`}
                          {r.changes.length > 0 && ` · ${r.changes.join(", ")}`}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="paste-foot">
                  <Button type="button" variant="primary" disabled={changes === 0 || importing} onClick={doImport} className="flex-1 sm:flex-none">
                    {importing ? "Importing…" : changes === 0 ? "Nothing new to import" : `Import ${changes} change${changes === 1 ? "" : "s"}`}
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setPreview(null)}>Edit the text</Button>
                </div>
              </section>
            )}
          </div>
        )}
      </ScheduleSheet>
    </>
  );
}

const order = { add: 0, update: 1, unchanged: 2 } as const;
