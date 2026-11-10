"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { saveNumbersAction } from "@/app/(app)/numbers/actions";
import { NumbersMenu } from "./numbers-menu";
import { cx } from "./ui";

export type SheetMetric = "views" | "reach" | "followers" | "engagements";
export type SheetPlatform = "instagram" | "tiktok";
type Row = {
  clientId: string;
  month: string;
  platform: "instagram" | "tiktok" | "google";
  source: "manual" | "api";
  views: number | null;
  reach: number | null;
  followers: number | null;
  engagements: number | null;
};
type SheetClient = { id: string; name: string; location: string | null };

type Status = "idle" | "saving" | "saved" | "error";
type Cell = { text: string; value: number | null; status: Status; error?: string };

const METRIC_LABEL: Record<SheetMetric, string> = { views: "Views", reach: "Reach", followers: "Followers", engagements: "Engagements" };
const PLATFORM_LABEL: Record<SheetPlatform, string> = { instagram: "Instagram", tiktok: "TikTok" };
const SAVE_DELAY = 1200;

const keyOf = (clientId: string, month: string, platform: string, field: string) => `${clientId}|${month}|${platform}|${field}`;
const rowKeyOf = (k: string) => k.split("|").slice(0, 3).join("|");
const fmt = (n: number | null) => (n == null ? "" : n.toLocaleString("en-US"));

/** "12,500" · "12.5k" · "1.2M" · "" (clear). Returns undefined when it isn't a number. */
export function parseNumber(raw: string): number | null | undefined {
  const s = raw.trim().replace(/[,\s_$]/g, "");
  if (!s || s === "-" || s === "—") return null;
  const m = /^(\d+(?:\.\d+)?|\.\d+)([kKmM])?$/.exec(s);
  if (!m) return undefined;
  const n = Number(m[1]) * (m[2] ? (m[2].toLowerCase() === "k" ? 1_000 : 1_000_000) : 1);
  return Number.isFinite(n) && n <= 2_000_000_000 ? Math.round(n) : undefined;
}

function shift(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}
function label(month: string, style: "short" | "long" | "month") {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1, 15));
  if (style === "month") return d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  return d.toLocaleDateString("en-US", { month: style === "long" ? "long" : "short", year: "numeric", timeZone: "UTC" });
}

export function NumbersSheet({
  end,
  current,
  months,
  initialMetric,
  initialPlatform,
  clients,
  rows,
}: {
  end: string;
  current: string;
  months: string[];
  initialMetric: SheetMetric;
  initialPlatform: SheetPlatform;
  clients: SheetClient[];
  rows: Row[];
}) {
  const [metric, setMetric] = useState<SheetMetric>(initialMetric);
  const [platform, setPlatform] = useState<SheetPlatform>(initialPlatform);

  /* ---------- state: one entry per (business, month, platform, field) that has been seen ---------- */
  const [cells, setCells] = useState<Record<string, Cell>>(() => {
    const out: Record<string, Cell> = {};
    for (const r of rows) {
      if (r.platform === "google") continue;
      for (const f of ["views", "reach", "followers", "engagements"] as const) {
        out[keyOf(r.clientId, r.month, r.platform, f)] = { text: fmt(r[f]), value: r[f], status: "idle" };
      }
    }
    return out;
  });
  const [sources, setSources] = useState<Record<string, "manual" | "api">>(() =>
    Object.fromEntries(rows.map((r) => [`${r.clientId}|${r.month}|${r.platform}`, r.source])),
  );

  // Refs mirror what callbacks need synchronously.
  const text = useRef<Record<string, string>>(Object.fromEntries(Object.entries(cells).map(([k, c]) => [k, c.text])));
  const saved = useRef<Record<string, number | null>>(Object.fromEntries(Object.entries(cells).map(([k, c]) => [k, c.value])));
  const version = useRef<Record<string, number>>({});
  const dirty = useRef<Set<string>>(new Set());
  const failed = useRef<Set<string>>(new Set()); // retried the next time the cell is left
  const inFlight = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const patch = useCallback((k: string, p: Partial<Cell>) => {
    setCells((prev) => ({ ...prev, [k]: { ...(prev[k] ?? { text: "", value: null, status: "idle" }), ...p } }));
  }, []);

  const send = useCallback(
    async (batch: Array<{ k: string; value: number | null; v: number }>) => {
      if (!batch.length) return;
      inFlight.current++;
      setCells((prev) => {
        const next = { ...prev };
        for (const b of batch) next[b.k] = { ...next[b.k], status: "saving", error: undefined };
        return next;
      });
      let res: Awaited<ReturnType<typeof saveNumbersAction>>;
      try {
        res = await saveNumbersAction(
          batch.map((b) => {
            const [clientId, month, platform, field] = b.k.split("|");
            return { clientId, month, platform, field, value: b.value };
          }),
        );
      } catch {
        res = { error: "Couldn't reach the server. Check your connection." };
      }
      inFlight.current--;
      const ok: string[] = [];
      const outcome = batch.map((b, i) => {
        const r = "error" in res ? { ok: false as const, error: res.error } : (res.results[i] ?? { ok: false as const, error: "No reply" });
        if (r.ok) {
          saved.current[b.k] = b.value;
          failed.current.delete(b.k);
          ok.push(b.k);
        } else failed.current.add(b.k);
        // Edited again since? That edit has its own save; don't overwrite its status.
        return { k: b.k, current: version.current[b.k] === b.v, r };
      });
      setCells((prev) => {
        const next = { ...prev };
        for (const { k, current, r } of outcome) {
          if (current) next[k] = { ...next[k], status: r.ok ? "saved" : "error", error: r.ok ? undefined : r.error };
        }
        return next;
      });
      if (ok.length) {
        setSources((prev) => {
          const next = { ...prev };
          for (const k of ok) next[rowKeyOf(k)] = "manual";
          return next;
        });
        // Let the green tick fade.
        setTimeout(() => {
          setCells((prev) => {
            const next = { ...prev };
            for (const k of ok) if (next[k]?.status === "saved") next[k] = { ...next[k], status: "idle" };
            return next;
          });
        }, 1600);
      }
    },
    [],
  );

  /** Validate every dirty cell and save the ones that changed. */
  const commit = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const batch: Array<{ k: string; value: number | null; v: number }> = [];
    for (const k of dirty.current) {
      const t = text.current[k] ?? "";
      const value = parseNumber(t);
      if (value === undefined) {
        patch(k, { status: "error", error: "Use a number like 12500 or 12.5k" });
        continue;
      }
      if (value === (saved.current[k] ?? null)) {
        patch(k, { status: "idle", error: undefined });
        continue;
      }
      batch.push({ k, value, v: version.current[k] ?? 0 });
    }
    dirty.current.clear();
    void send(batch);
  }, [patch, send]);

  const edit = useCallback(
    (k: string, t: string, opts: { now?: boolean } = {}) => {
      text.current[k] = t;
      version.current[k] = (version.current[k] ?? 0) + 1;
      dirty.current.add(k);
      const value = parseNumber(t);
      patch(k, { text: t, status: "idle", error: undefined, ...(value !== undefined ? { value } : {}) });
      if (timer.current) clearTimeout(timer.current);
      if (opts.now) commit();
      else timer.current = setTimeout(commit, SAVE_DELAY);
    },
    [commit, patch],
  );

  /** Leaving a cell: save it now and tidy what's shown ("12.5k" → "12,500"). */
  const leave = useCallback(
    (k: string) => {
      if (failed.current.has(k)) dirty.current.add(k);
      if (dirty.current.has(k)) commit();
      const v = parseNumber(text.current[k] ?? "");
      if (v !== undefined && (text.current[k] ?? "") !== fmt(v)) {
        text.current[k] = fmt(v);
        patch(k, { text: fmt(v) });
      }
    },
    [commit, patch],
  );

  const revert = useCallback(
    (k: string) => {
      dirty.current.delete(k);
      version.current[k] = (version.current[k] ?? 0) + 1;
      const v = saved.current[k] ?? null;
      text.current[k] = fmt(v);
      patch(k, { text: fmt(v), value: v, status: "idle", error: undefined });
    },
    [patch],
  );

  // Save anything pending when leaving (range change remounts this component).
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty.current.size || inFlight.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
      if (dirty.current.size) commit();
    };
  }, [commit]);

  /* ---------- URL: metric/platform switch instantly (no server round trip) but survive a reload ---------- */
  const href = useCallback(
    (e: string, m: SheetMetric = metric, p: SheetPlatform = platform) => {
      const q = new URLSearchParams();
      if (e !== current) q.set("end", e);
      if (p !== "instagram") q.set("platform", p);
      if (m !== "views") q.set("metric", m);
      const s = q.toString();
      return s ? `/numbers?${s}` : "/numbers";
    },
    [current, metric, platform],
  );
  useEffect(() => {
    window.history.replaceState(null, "", href(end));
  }, [href, end]);

  /* ---------- derived ---------- */
  const valueOf = (clientId: string, month: string, p: SheetPlatform, f: SheetMetric) => cells[keyOf(clientId, month, p, f)]?.value ?? null;

  const status = useMemo(() => {
    const all = Object.values(cells);
    const errors = all.filter((c) => c.status === "error").length;
    const saving = all.some((c) => c.status === "saving");
    const savedNow = all.some((c) => c.status === "saved");
    return { errors, saving, savedNow };
  }, [cells]);

  const exportHref = `/numbers/export?end=${end}`;
  const latest = months[months.length - 1];
  const prevOfLatest = months[months.length - 2];

  return (
    <div>
      {/* ---------- controls (desktop) ---------- */}
      <div className="mb-4 hidden flex-wrap items-center gap-3 md:flex">
        <RangePicker end={end} current={current} months={months} href={href} onLeave={commit} />
        <div role="tablist" aria-label="Platform" className="inline-flex rounded-lg border border-border bg-surface p-0.5">
          {(["instagram", "tiktok"] as const).map((p) => (
            <button
              key={p}
              type="button"
              role="tab"
              aria-selected={platform === p}
              onClick={() => setPlatform(p)}
              className={cx(
                "rounded-md px-3 py-1.5 text-sm font-medium",
                platform === p ? "bg-accent-soft text-accent" : "text-muted hover:text-text",
              )}
            >
              {PLATFORM_LABEL[p]}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted">Show</span>
          <select value={metric} onChange={(e) => setMetric(e.target.value as SheetMetric)} className="input w-auto py-1.5">
            {(Object.keys(METRIC_LABEL) as SheetMetric[]).map((m) => (
              <option key={m} value={m}>
                {METRIC_LABEL[m]}
              </option>
            ))}
          </select>
        </label>
        <div className="ml-auto flex items-center gap-3">
          <SaveStatus {...status} />
          <NumbersMenu exportHref={exportHref} />
        </div>
      </div>

      {/* ---------- controls (phone) ---------- */}
      <div className="mb-3 flex items-center justify-between gap-2 md:hidden">
        <div className="inline-flex items-center rounded-lg border border-border bg-surface">
          <Link href={href(shift(end, -1))} onClick={commit} scroll={false} className="flex h-11 w-11 items-center justify-center rounded-l-lg" aria-label={`Previous month, ${label(shift(end, -1), "long")}`}>
            ←
          </Link>
          <span className="min-w-32 border-x border-border px-2 text-center text-sm font-semibold leading-[2.75rem]">{label(end, "long")}</span>
          {end < current ? (
            <Link href={href(shift(end, 1))} onClick={commit} scroll={false} className="flex h-11 w-11 items-center justify-center rounded-r-lg" aria-label={`Next month, ${label(shift(end, 1), "long")}`}>
              →
            </Link>
          ) : (
            <span aria-hidden className="flex h-11 w-11 items-center justify-center text-muted opacity-40">→</span>
          )}
        </div>
        <NumbersMenu exportHref={exportHref} />
      </div>

      {status.errors > 0 && (
        <p role="alert" className="mb-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {status.errors === 1 ? "1 number wasn't saved" : `${status.errors} numbers weren't saved`} — fix the red {status.errors === 1 ? "box" : "boxes"} and try again.
        </p>
      )}

      {/* ---------- phone: one month, IG + TikTok views side by side ---------- */}
      <div className="md:hidden">
        <p className="mb-2 text-xs text-muted">
          Views (impressions) · saves as you type{status.saving ? " · saving…" : ""}
        </p>
        <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
          {clients.map((c, i) => (
            <li key={c.id} className="px-3 py-3">
              <Link href={`/clients/${c.id}#views`} className="block min-w-0 pb-2">
                <span className="block truncate text-sm font-medium">{c.name}</span>
                {c.location && <span className="block truncate text-xs text-muted">{c.location}</span>}
              </Link>
              <div className="grid grid-cols-2 gap-2">
                {(["instagram", "tiktok"] as const).map((p, j) => {
                  const k = keyOf(c.id, end, p, "views");
                  const cell = cells[k];
                  const synced = sources[`${c.id}|${end}|${p}`] === "api";
                  return (
                    <label key={p} className="block min-w-0">
                      <span className={cx("mb-1 flex items-center gap-1 text-xs font-medium", p === "instagram" ? "text-ig" : "text-tt")}>
                        {PLATFORM_LABEL[p]}
                        {synced && <span className="font-normal text-muted">· synced</span>}
                        <StatusDot status={cell?.status} />
                      </span>
                      <input
                        data-phone-cell={i * 2 + j}
                        value={cell?.text ?? ""}
                        onChange={(e) => edit(k, e.target.value)}
                        onBlur={() => leave(k)}
                        onFocus={(e) => e.currentTarget.select()}
                        onKeyDown={(e) => {
                          if (e.key !== "Enter") return;
                          e.preventDefault();
                          const nextEl = document.querySelector<HTMLInputElement>(`[data-phone-cell="${i * 2 + j + 1}"]`);
                          if (nextEl) nextEl.focus();
                          else e.currentTarget.blur();
                        }}
                        inputMode="decimal"
                        enterKeyHint={i === clients.length - 1 && j === 1 ? "done" : "next"}
                        autoComplete="off"
                        placeholder="—"
                        aria-invalid={cell?.status === "error" || undefined}
                        title={cell?.error}
                        className={cx("input text-right tabular-nums", cell?.status === "error" && "border-danger")}
                      />
                      {cell?.status === "error" && <span className="mt-1 block text-xs text-danger">{cell.error}</span>}
                    </label>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* ---------- desktop: the sheet ---------- */}
      <div className="hidden md:block">
        <Grid
          clients={clients}
          months={months}
          current={current}
          platform={platform}
          metric={metric}
          cells={cells}
          sources={sources}
          edit={edit}
          leave={leave}
          revert={revert}
          valueOf={valueOf}
          latest={latest}
          prevOfLatest={prevOfLatest}
        />
        <p className="mt-2 text-xs text-muted">
          {metric === "views" ? "Views (impressions): Instagram renamed impressions to views in 2025. " : ""}
          Arrow keys or Enter to move · paste a block straight from Google Sheets · “12.5k” works · clear a box to remove a number.
          <span className="ml-1 inline-flex items-center gap-1"><SyncIcon /> = synced automatically; you can still type over it.</span>
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ grid */

function Grid({
  clients,
  months,
  current,
  platform,
  metric,
  cells,
  sources,
  edit,
  leave,
  revert,
  valueOf,
  latest,
  prevOfLatest,
}: {
  clients: SheetClient[];
  months: string[];
  current: string;
  platform: SheetPlatform;
  metric: SheetMetric;
  cells: Record<string, Cell>;
  sources: Record<string, "manual" | "api">;
  edit: (k: string, t: string, opts?: { now?: boolean }) => void;
  leave: (k: string) => void;
  revert: (k: string) => void;
  valueOf: (clientId: string, month: string, p: SheetPlatform, f: SheetMetric) => number | null;
  latest: string;
  prevOfLatest: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const focusCell = (r: number, c: number) => {
    const el = box.current?.querySelector<HTMLInputElement>(`[data-cell="${r}:${c}"]`);
    if (el) {
      el.focus();
      el.select();
    }
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>, r: number, c: number, k: string) => {
    const el = e.currentTarget;
    const atStart = el.selectionStart === 0 && el.selectionEnd === 0;
    const atEnd = el.selectionStart === el.value.length && el.selectionEnd === el.value.length;
    const all = el.selectionStart === 0 && el.selectionEnd === el.value.length;
    switch (e.key) {
      case "ArrowUp":
        e.preventDefault();
        focusCell(r - 1, c);
        break;
      case "ArrowDown":
        e.preventDefault();
        focusCell(r + 1, c);
        break;
      case "Enter":
        e.preventDefault();
        leave(k);
        focusCell(e.shiftKey ? r - 1 : r + 1, c);
        break;
      case "ArrowLeft":
        if (atStart || all) {
          e.preventDefault();
          focusCell(r, c - 1);
        }
        break;
      case "ArrowRight":
        if (atEnd || all) {
          e.preventDefault();
          focusCell(r, c + 1);
        }
        break;
      case "Escape":
        e.preventDefault();
        revert(k);
        break;
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>, r: number, c: number) => {
    const raw = e.clipboardData.getData("text/plain");
    if (!/[\t\n]/.test(raw.replace(/\r?\n$/, ""))) return; // single value: normal paste
    e.preventDefault();
    const keys: string[] = [];
    const lines = raw.replace(/\r/g, "").replace(/\n$/, "").split("\n");
    lines.forEach((line, dr) => {
      const client = clients[r + dr];
      if (!client) return;
      line.split("\t").forEach((v, dc) => {
        const month = months[c + dc];
        if (!month) return;
        const k = keyOf(client.id, month, platform, metric);
        edit(k, v.trim().replace(/^"|"$/g, ""));
        keys.push(k);
      });
    });
    keys.forEach(leave); // first one saves the whole block in one request
  };

  const total = (m: string) => {
    let sum = 0;
    let any = false;
    for (const cl of clients) {
      const v = valueOf(cl.id, m, platform, metric);
      if (v != null) {
        sum += v;
        any = true;
      }
    }
    return any ? sum : null;
  };

  const head = "px-2 py-2 text-right text-xs font-semibold text-muted";
  return (
    <div ref={box} className="relative overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full min-w-[44rem] border-collapse text-sm">
        <caption className="sr-only">
          {PLATFORM_LABEL[platform]} {METRIC_LABEL[metric].toLowerCase()} by business and month
        </caption>
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className="sticky left-0 z-10 bg-surface px-3 py-2 text-left text-xs font-semibold text-muted">
              Business
            </th>
            {months.map((m) => (
              <th key={m} scope="col" className={cx(head, "w-[9.5%]", m === current && "text-accent")}>
                {label(m, "month")} <span className="font-normal">{m.slice(2, 4)}</span>
              </th>
            ))}
            <th scope="col" className={cx(head, "w-[8%] border-l border-border")} title={`${label(latest, "long")} vs ${label(prevOfLatest, "long")}`}>
              vs last month
            </th>
          </tr>
        </thead>
        <tbody>
          {clients.map((cl, r) => {
            const cur = valueOf(cl.id, latest, platform, metric);
            const prev = valueOf(cl.id, prevOfLatest, platform, metric);
            return (
              <tr key={cl.id} className="border-b border-border">
                <th scope="row" className="sticky left-0 z-10 max-w-56 bg-surface px-3 py-1.5 text-left font-normal">
                  <Link href={`/clients/${cl.id}#views`} className="block truncate font-medium hover:underline">
                    {cl.name}
                  </Link>
                  {cl.location && <span className="block truncate text-xs text-muted">{cl.location}</span>}
                </th>
                {months.map((m, c) => {
                  const k = keyOf(cl.id, m, platform, metric);
                  const cell = cells[k];
                  const synced = sources[`${cl.id}|${m}|${platform}`] === "api";
                  return (
                    <td key={m} className="relative border-l border-border p-0">
                      <input
                        data-cell={`${r}:${c}`}
                        value={cell?.text ?? ""}
                        onChange={(e) => edit(k, e.target.value)}
                        onBlur={() => leave(k)}
                        onFocus={(e) => e.currentTarget.select()}
                        onKeyDown={(e) => onKey(e, r, c, k)}
                        onPaste={(e) => onPaste(e, r, c)}
                        inputMode="decimal"
                        autoComplete="off"
                        spellCheck={false}
                        aria-label={`${cl.name}${cl.location ? ` ${cl.location}` : ""}, ${label(m, "long")}`}
                        aria-invalid={cell?.status === "error" || undefined}
                        title={cell?.error ?? (synced ? "Synced automatically — you can still edit it" : undefined)}
                        className={cx(
                          "block h-10 w-full bg-transparent px-2 text-right tabular-nums outline-none focus:bg-accent-soft/40 focus:ring-2 focus:ring-inset focus:ring-accent",
                          cell?.status === "error" && "bg-danger-soft text-danger ring-1 ring-inset ring-danger",
                          cell?.status === "saving" && "text-muted",
                        )}
                      />
                      {synced && (
                        <span className="pointer-events-none absolute left-1 top-1 text-muted" aria-hidden>
                          <SyncIcon />
                        </span>
                      )}
                      <span className="pointer-events-none absolute bottom-1 left-1">
                        <StatusDot status={cell?.status} />
                      </span>
                    </td>
                  );
                })}
                <td className="border-l border-border px-2 text-right">
                  <Change cur={cur} prev={prev} />
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="bg-surface-2/60 font-semibold">
            <th scope="row" className="sticky left-0 z-10 bg-surface-2 px-3 py-2 text-left text-xs">
              Total
            </th>
            {months.map((m) => {
              const t = total(m);
              return (
                <td key={m} className="border-l border-border px-2 py-2 text-right tabular-nums">
                  {t == null ? <span className="text-muted">—</span> : t.toLocaleString("en-US")}
                </td>
              );
            })}
            <td className="border-l border-border px-2 text-right">
              <Change cur={total(latest)} prev={total(prevOfLatest)} />
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/* --------------------------------------------------------------- bits */

function RangePicker({ end, current, months, href, onLeave }: { end: string; current: string; months: string[]; href: (e: string) => string; onLeave: () => void }) {
  const router = useRouter();
  const first = months[0];
  const sameYear = first.slice(0, 4) === end.slice(0, 4);
  const text = `${sameYear ? label(first, "month") : label(first, "short")} – ${label(end, "short")}`;
  const btn = "flex h-9 w-9 items-center justify-center text-sm hover:bg-surface-2";
  return (
    <div className="flex items-center gap-2">
      <div className="inline-flex items-center rounded-lg border border-border bg-surface">
        <Link href={href(shift(end, -1))} onClick={onLeave} scroll={false} className={cx(btn, "rounded-l-lg")} aria-label="One month earlier" title="One month earlier">
          ←
        </Link>
        <label className="relative border-x border-border">
          <span className="sr-only">Last month shown</span>
          <span aria-hidden className="pointer-events-none block min-w-36 px-3 py-2 text-center text-sm font-semibold">
            {text}
          </span>
          <input
            type="month"
            value={end}
            max={current}
            onChange={(e) => {
              if (/^\d{4}-\d{2}$/.test(e.target.value) && e.target.value <= current) {
                onLeave();
                router.push(href(e.target.value), { scroll: false });
              }
            }}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </label>
        {end < current ? (
          <Link href={href(shift(end, 1))} onClick={onLeave} scroll={false} className={cx(btn, "rounded-r-lg")} aria-label="One month later" title="One month later">
            →
          </Link>
        ) : (
          <span aria-hidden className={cx(btn, "cursor-default text-muted opacity-40 hover:bg-transparent")}>→</span>
        )}
      </div>
      {end !== current && (
        <Link href={href(current)} onClick={onLeave} scroll={false} className="text-xs text-accent hover:underline">
          Back to now
        </Link>
      )}
    </div>
  );
}

function Change({ cur, prev }: { cur: number | null; prev: number | null }) {
  if (cur == null || prev == null || prev === 0) return <span className="text-xs text-muted">—</span>;
  const pct = Math.round(((cur - prev) / prev) * 100);
  return (
    <span className={cx("text-xs font-medium tabular-nums", pct > 0 ? "text-ok" : pct < 0 ? "text-danger" : "text-muted")}>
      {pct > 0 ? "+" : ""}
      {pct}%
    </span>
  );
}

function SaveStatus({ errors, saving, savedNow }: { errors: number; saving: boolean; savedNow: boolean }) {
  const msg = saving ? "Saving…" : errors ? "" : savedNow ? "Saved" : "";
  return (
    <span aria-live="polite" className={cx("text-xs", savedNow && !saving ? "text-ok" : "text-muted")}>
      {msg}
    </span>
  );
}

function StatusDot({ status }: { status?: Status }) {
  if (status === "saving") return <span className="inline-block size-1.5 animate-pulse rounded-full bg-muted" aria-label="Saving" />;
  if (status === "saved") return <span className="inline-block size-1.5 rounded-full bg-ok" aria-label="Saved" />;
  return null;
}

function SyncIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-2.5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M13 6.5A5 5 0 0 0 4 4.5L3 6M3 9.5a5 5 0 0 0 9 2l1-1.5M3 2.5V6h3.5M13 13.5V10H9.5" />
    </svg>
  );
}
