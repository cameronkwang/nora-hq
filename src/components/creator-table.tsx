"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { saveCreatorCellAction, type CellField } from "@/app/(app)/creators/actions";
import { Badge, StatusBadge, cx, formatNumber } from "./ui";

/** Plain, serialisable row for the creators table (built on the server in creators/page.tsx). */
export type CreatorTableRow = {
  id: string;
  name: string;
  instagramHandle: string | null;
  tiktokHandle: string | null;
  email: string | null;
  city: string | null;
  niche: string | null;
  instagramFollowers: number | null;
  tiktokFollowers: number | null;
  engagementRate: number | null;
  doNotContact: boolean;
  outreach: Array<{ id: string; client: string; stage: string; due: boolean; dim: boolean }>;
  /** Earliest follow-up date on an open relationship. */
  nextFollowUp: { at: string; label: string; due: boolean } | null;
};

type SortKey = CellField | "businesses" | "nextFollowUp";
type Kind = "text" | "handle" | "email" | "count" | "rate";

const COLUMNS: Array<{ key: SortKey; label: string; kind?: Kind; num?: boolean; width: string }> = [
  { key: "name", label: "Name", kind: "text", width: "w-48" },
  { key: "instagramHandle", label: "IG", kind: "handle", width: "w-32" },
  { key: "tiktokHandle", label: "TikTok", kind: "handle", width: "w-32" },
  { key: "email", label: "Email", kind: "email", width: "w-44" },
  { key: "city", label: "City", kind: "text", width: "w-32" },
  { key: "niche", label: "Niche", kind: "text", width: "w-32" },
  { key: "instagramFollowers", label: "IG followers", kind: "count", num: true, width: "w-24" },
  { key: "tiktokFollowers", label: "TikTok followers", kind: "count", num: true, width: "w-24" },
  { key: "engagementRate", label: "Eng. %", kind: "rate", num: true, width: "w-20" },
  { key: "businesses", label: "Businesses", width: "" },
  { key: "nextFollowUp", label: "Next follow-up", width: "w-28" },
];

function sortValue(r: CreatorTableRow, key: SortKey): string | number | null {
  if (key === "businesses") return r.outreach.length || null;
  if (key === "nextFollowUp") return r.nextFollowUp?.at ?? null;
  const v = r[key];
  return typeof v === "string" ? v.toLowerCase() : v;
}

/**
 * Spreadsheet-style roster. Desktop: sortable columns, every text/number cell edits in place and saves
 * when you leave it (Enter saves, Esc undoes). Phones: stacked cards with an Edit link.
 */
export function CreatorTable({ rows: initial }: { rows: CreatorTableRow[] }) {
  const [rows, setRows] = useState(initial);
  useEffect(() => setRows(initial), [initial]);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "name", dir: 1 });
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null);

  const sorted = useMemo(() => {
    const out = [...rows];
    out.sort((a, b) => {
      const va = sortValue(a, sort.key), vb = sortValue(b, sort.key);
      if (va == null && vb == null) return a.name.localeCompare(b.name);
      if (va == null) return 1; // empty cells always sink
      if (vb == null) return -1;
      const c = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
      return c * sort.dir || a.name.localeCompare(b.name);
    });
    return out;
    // Re-sort only when the sort changes or rows are added/removed, so an edited row doesn't jump away mid-edit.
  }, [sort, rows.length, initial]);
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);

  const onSaved = (id: string, field: CellField, value: string | number | null) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, [field]: value } : r)));

  return (
    <>
      <p className="sr-only" role="status" aria-live="polite">{status?.text}</p>
      {status?.error && (
        <p role="alert" className="mb-3 hidden rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger md:block">{status.text}</p>
      )}

      {/* Phones: stacked cards */}
      <ul className="divide-y divide-border md:hidden">
        {sorted.map((r0) => {
          const r = byId.get(r0.id) ?? r0;
          return <CreatorCard key={r.id} r={r} />;
        })}
      </ul>

      {/* Tablet / desktop: the spreadsheet */}
      <div className="relative hidden max-h-[calc(100dvh-14rem)] overflow-auto md:block" role="region" aria-label="Creators table" tabIndex={-1}>
        <table className="w-full min-w-[94rem] table-fixed border-separate border-spacing-0 text-left text-sm">
          <thead className="text-xs text-muted">
            <tr>
              {COLUMNS.map((c, i) => {
                const active = sort.key === c.key;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : undefined}
                    className={cx("sticky top-0 border-b border-border bg-surface px-1 py-1.5 font-medium", c.width, c.num && "text-right", i === 0 ? "left-0 z-20" : "z-10")}
                  >
                    <button
                      type="button"
                      onClick={() => setSort((s) => (s.key === c.key ? { key: c.key, dir: s.dir === 1 ? -1 : 1 } : { key: c.key, dir: c.num || c.key === "businesses" ? -1 : 1 }))}
                      className={cx("inline-flex min-h-8 items-center gap-1 rounded px-1.5 hover:text-text", active && "text-text", c.num && "flex-row-reverse")}
                    >
                      {c.label}
                      <span aria-hidden className={cx("text-[10px]", !active && "invisible")}>{sort.dir === 1 ? "▲" : "▼"}</span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r0) => {
              const r = byId.get(r0.id) ?? r0;
              return (
                <tr key={r.id} className={cx("group", r.doNotContact && "text-muted")}>
                  {COLUMNS.map((c, i) => (
                    <td
                      key={c.key}
                      className={cx(
                        "border-b border-border px-1 py-1 align-middle",
                        i === 0 ? "sticky left-0 z-[1] bg-surface" : "group-hover:bg-surface-2/50",
                      )}
                    >
                      {c.key === "businesses" ? (
                        <Businesses r={r} />
                      ) : c.key === "nextFollowUp" ? (
                        <FollowUp r={r} />
                      ) : (
                        <div className="flex items-center gap-1">
                          <EditableCell
                            rowId={r.id}
                            field={c.key}
                            kind={c.kind!}
                            value={r[c.key]}
                            label={`${c.label} for ${r.name}`}
                            onSaved={(v) => onSaved(r.id, c.key as CellField, v)}
                            onStatus={setStatus}
                          />
                          {i === 0 && (
                            <>
                              {r.doNotContact && <Badge tone="danger" className="shrink-0">DNC</Badge>}
                              <Link
                                href={`/creators/${r.id}`}
                                aria-label={`Open ${r.name}`}
                                title="Open profile"
                                className="tap-target shrink-0 rounded p-1 text-muted hover:bg-surface-2 hover:text-text"
                              >
                                <svg viewBox="0 0 16 16" aria-hidden className="size-3.5" fill="none" stroke="currentColor" strokeWidth={1.8}>
                                  <path d="M6 3.5 10.5 8 6 12.5" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              </Link>
                            </>
                          )}
                        </div>
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="hidden px-4 py-2 text-xs text-muted md:block">Click any cell to edit. Changes save when you leave the cell — Enter saves, Esc undoes.</p>
    </>
  );
}

function display(kind: Kind, v: string | number | null): string {
  if (v == null || v === "") return "";
  if (kind === "count") return formatNumber(Number(v));
  if (kind === "rate") return `${Number(v).toFixed(1).replace(/\.0$/, "")}%`;
  if (kind === "handle") return `@${v}`;
  return String(v);
}

function EditableCell({
  rowId,
  field,
  kind,
  value,
  label,
  onSaved,
  onStatus,
}: {
  rowId: string;
  field: CellField;
  kind: Kind;
  value: string | number | null;
  label: string;
  onSaved: (v: string | number | null) => void;
  onStatus: (s: { text: string; error?: boolean } | null) => void;
}) {
  const raw = value == null ? "" : String(value);
  const [draft, setDraft] = useState<string | null>(null); // null = not editing
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");
  const cancel = useRef(false);

  async function commit(text: string) {
    if (text.trim() === raw.trim() || (kind === "handle" && text.trim().replace(/^@/, "").toLowerCase() === raw)) {
      if (state === "error") setState("idle");
      return;
    }
    setState("saving");
    const res = await saveCreatorCellAction(rowId, field, text);
    if (res.ok) {
      onSaved(res.value);
      setState("saved");
      setError("");
      onStatus({ text: `Saved ${label}` });
      setTimeout(() => setState((s) => (s === "saved" ? "idle" : s)), 1200);
    } else {
      setState("error");
      setError(res.error);
      onStatus({ text: res.error, error: true });
    }
  }

  return (
    <input
      aria-label={label}
      aria-invalid={state === "error" || undefined}
      title={state === "error" ? error : undefined}
      inputMode={kind === "count" || kind === "rate" ? "decimal" : kind === "email" ? "email" : undefined}
      autoCapitalize={kind === "text" ? undefined : "none"}
      autoComplete="off"
      spellCheck={kind === "text" ? undefined : false}
      placeholder="—"
      size={1}
      value={draft ?? display(kind, value)}
      onFocus={(e) => {
        setDraft(raw);
        const el = e.currentTarget;
        requestAnimationFrame(() => el.select());
      }}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          cancel.current = true;
          setState((s) => (s === "error" ? "idle" : s));
          e.currentTarget.blur();
        }
      }}
      onBlur={() => {
        const text = draft ?? raw;
        setDraft(null);
        if (cancel.current) {
          cancel.current = false;
          return;
        }
        void commit(text);
      }}
      className={cx(
        "w-full min-w-0 truncate rounded-md border bg-transparent px-1.5 py-1 text-sm outline-none transition",
        "placeholder:text-muted/60 hover:border-border focus:border-accent focus:bg-surface",
        (kind === "count" || kind === "rate") && "text-right tabular-nums",
        field === "name" && "font-medium",
        kind === "handle" && (field === "instagramHandle" ? "text-ig" : "text-tt"),
        state === "error" ? "border-danger bg-danger-soft" : state === "saved" ? "border-ok" : "border-transparent",
        state === "saving" && "opacity-60",
      )}
    />
  );
}

function Businesses({ r }: { r: CreatorTableRow }) {
  if (r.outreach.length === 0) return <span className="px-1.5 text-xs text-muted">—</span>;
  return (
    <Link href={`/creators/${r.id}`} className="flex flex-wrap gap-1 rounded px-1 py-0.5 hover:bg-surface-2" aria-label={`${r.name}: ${r.outreach.map((o) => `${o.client} ${o.stage.replace(/_/g, " ")}`).join(", ")}`}>
      {r.outreach.map((o) => (
        <span key={o.id} className={cx("inline-flex items-center gap-1 rounded-full border border-border py-px pl-2 pr-px text-xs", o.dim && "opacity-50")}>
          <span className="max-w-28 truncate">{o.client}</span>
          <StatusBadge status={o.stage} />
        </span>
      ))}
    </Link>
  );
}

function FollowUp({ r }: { r: CreatorTableRow }) {
  if (!r.nextFollowUp) return <span className="px-1.5 text-xs text-muted">—</span>;
  return r.nextFollowUp.due ? (
    <Badge tone="warn">Due {r.nextFollowUp.label}</Badge>
  ) : (
    <span className="px-1.5 text-sm tabular-nums">{r.nextFollowUp.label}</span>
  );
}

function CreatorCard({ r }: { r: CreatorTableRow }) {
  const stats = [
    r.instagramFollowers != null ? `IG ${formatNumber(r.instagramFollowers)}` : "",
    r.tiktokFollowers != null ? `TikTok ${formatNumber(r.tiktokFollowers)}` : "",
    r.engagementRate != null ? `${r.engagementRate.toFixed(1).replace(/\.0$/, "")}% eng.` : "",
  ].filter(Boolean);
  return (
    <li className="px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/creators/${r.id}`} className="font-medium hover:underline">{r.name}</Link>
            {r.doNotContact && <Badge tone="danger">Do not contact</Badge>}
          </div>
          <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs">
            {r.instagramHandle && <span className="text-ig">@{r.instagramHandle}</span>}
            {r.tiktokHandle && <span className="text-tt">TT @{r.tiktokHandle}</span>}
            {!r.instagramHandle && !r.tiktokHandle && r.email && <span className="truncate text-muted">{r.email}</span>}
          </p>
          {(r.city || r.niche || stats.length > 0) && (
            <p className="mt-0.5 text-xs text-muted">{[r.city, r.niche, ...stats].filter(Boolean).join(" · ")}</p>
          )}
        </div>
        <Link href={`/creators/${r.id}`} className="-mr-2 inline-flex min-h-11 shrink-0 items-center rounded-lg px-3 text-sm font-medium text-accent hover:bg-surface-2">
          Edit
        </Link>
      </div>
      {(r.outreach.length > 0 || r.nextFollowUp) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {r.outreach.map((o) => (
            <span key={o.id} className={cx("inline-flex items-center gap-1 rounded-full border border-border py-px pl-2 pr-px text-xs", o.dim && "opacity-50")}>
              <span className="max-w-32 truncate">{o.client}</span>
              <StatusBadge status={o.stage} />
            </span>
          ))}
          {r.nextFollowUp && (
            r.nextFollowUp.due ? <Badge tone="warn">Follow up due</Badge> : <span className="text-xs text-muted">Follow up {r.nextFollowUp.label}</span>
          )}
        </div>
      )}
    </li>
  );
}
