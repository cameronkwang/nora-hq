"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { importScheduleAction } from "@/app/(app)/calendar/schedule-actions";
import type { ImportResult } from "@/lib/ops-schedule";
import { ScheduleSheet } from "./schedule-sheet";
import { Badge, Button, buttonClass, cx } from "./ui";

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
      setDone(`Done — ${r.result.add} added, ${r.result.update} updated.`);
      setPreview(null);
      router.refresh();
    });

  const changes = preview ? preview.add + preview.update : 0;
  const shown = preview ? [...preview.rows].sort((a, b) => order[a.action] - order[b.action]) : [];

  return (
    <>
      <button type="button" className={buttonClass("secondary")} onClick={() => setOpen(true)} aria-haspopup="dialog">
        Paste schedule
      </button>
      <ScheduleSheet
        open={open}
        onClose={close}
        wide
        title="Paste Nora's schedule"
        subtitle="Copy the list from your notes and paste it here. Dates, FREE and 📸 are kept; amounts and payment notes are left out."
      >
        {done ? (
          <div role="status" className="space-y-3 py-2">
            <p className="rounded-lg bg-ok-soft px-3 py-2 text-sm text-ok">{done}</p>
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
              <p className="mt-1 text-xs text-muted">One per line: <code>11/04 | Business</code>. Use <code>11/XX</code> when there&apos;s no set day. Pasting again updates — nothing is duplicated.</p>
            </div>

            {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

            {!preview && (
              <div>
                <Button type="button" variant="primary" disabled={!text.trim() || checking} onClick={check}>
                  {checking ? "Reading…" : "Preview"}
                </Button>
              </div>
            )}

            {preview && (
              <section aria-label="Preview" className="rounded-xl border border-border">
                <header className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2.5 text-sm">
                  <Badge tone="accent">{preview.add} new</Badge>
                  <Badge tone="info">{preview.update} to update</Badge>
                  <Badge>{preview.unchanged} unchanged</Badge>
                  {preview.skipped.length > 0 && <Badge tone="warn">{preview.skipped.length} skipped</Badge>}
                </header>
                <ul className="max-h-[45dvh] divide-y divide-border overflow-y-auto">
                  {preview.skipped.map((s, i) => (
                    <li key={`skip-${i}`} className="flex gap-3 bg-warn-soft/40 px-3 py-2 text-sm">
                      <span className="w-16 shrink-0 text-xs font-semibold text-warn">Skipped</span>
                      <span className="min-w-0 flex-1">
                        <span className="block break-words font-mono text-xs">{s.line || "(empty)"}</span>
                        <span className="block text-xs text-muted">{s.reason}</span>
                      </span>
                    </li>
                  ))}
                  {shown.map((r, i) => (
                    <li key={`${r.month}-${r.businessName}-${i}`} className={cx("flex gap-3 px-3 py-2 text-sm", r.action === "unchanged" && "text-muted")}>
                      <span className={cx("w-16 shrink-0 text-xs font-semibold", r.action === "add" ? "text-accent" : r.action === "update" ? "text-info" : "text-muted")}>
                        {r.action === "add" ? "New" : r.action === "update" ? "Update" : "Same"}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="font-medium">{r.businessName}</span>
                          {r.isFree && <Badge tone="ok">Free</Badge>}
                          {r.needsReel && <span title="Reel to post">📸</span>}
                        </span>
                        <span className="block text-xs text-muted">
                          {monthShort(r.month)} · {day(r.date)}
                          {r.clientName && ` · ${r.clientName}`}
                          {r.changes.length > 0 && ` · ${r.changes.join(", ")}`}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap items-center gap-2 border-t border-border p-3">
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
