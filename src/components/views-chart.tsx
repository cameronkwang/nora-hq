"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { cx, formatNumber } from "./ui";

export type ViewsPoint = { month: string; label: string; longLabel: string; instagram: number | null; tiktok: number | null };

/**
 * 12-month views trend, Instagram vs TikTok. Dependency-free inline SVG.
 * Two-series line chart (change over time); one shared y-axis; crosshair + tooltip on hover/focus;
 * arrow keys step through months; a table view carries every value without hovering.
 * Series colors are chart-local and validated for CVD separation in light and dark
 * (TikTok's brand black/white reads as axis ink, so the TikTok line uses blue).
 */
const SERIES = [
  { key: "instagram" as const, name: "Instagram", color: "var(--viz-ig)" },
  { key: "tiktok" as const, name: "TikTok", color: "var(--viz-tt)" },
];

const HEIGHT = 220;
const M = { top: 12, bottom: 28, left: 8 };

function niceStep(raw: number) {
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * pow;
}

function scaleFor(max: number) {
  if (max <= 0) return { top: 4, step: 1 };
  const step = Math.max(1, niceStep(max / 4));
  return { top: Math.ceil(max / step) * step, step };
}

function tickText(n: number, top: number) {
  return top >= 10_000 ? formatNumber(n) : n.toLocaleString("en-US");
}

export function ViewsChart({ points, title }: { points: ViewsPoint[]; title: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [active, setActive] = useState<number | null>(null);
  const uid = useId();

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(260, Math.round(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = points.length;
  const values = points.flatMap((p) => [p.instagram, p.tiktok]).filter((v): v is number => v != null);
  const hasData = values.length > 0;
  const { top, step } = scaleFor(Math.max(0, ...values));
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);

  const tickW = Math.max(...ticks.map((t) => tickText(t, top).length)) * 6.5 + 8;
  const wide = width >= 520;
  const left = M.left + tickW;
  const right = wide ? 76 : 12;
  const plotW = Math.max(40, width - left - right);
  const plotH = HEIGHT - M.top - M.bottom;
  const x = (i: number) => left + (n <= 1 ? plotW / 2 : (i * plotW) / (n - 1));
  const y = (v: number) => M.top + plotH - (v / top) * plotH;

  const labelEvery = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 44))));

  const paths = useMemo(
    () =>
      SERIES.map((s) => {
        let d = "";
        let pen = false;
        const isolated: number[] = [];
        points.forEach((p, i) => {
          const v = p[s.key];
          if (v == null) { pen = false; return; }
          d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
          const prev = i > 0 ? points[i - 1][s.key] : null;
          const next = i < n - 1 ? points[i + 1][s.key] : null;
          if (prev == null && next == null) isolated.push(i);
          pen = true;
        });
        let last = -1;
        points.forEach((p, i) => { if (p[s.key] != null) last = i; });
        return { ...s, d, isolated, last };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [points, width, top],
  );

  // Direct end labels only when there's room and they don't collide.
  const ends = paths.filter((p) => p.last >= 0).map((p) => ({ ...p, ey: y(points[p.last][p.key] as number), ex: x(p.last) }));
  const showDirect = wide && ends.length > 0 && (ends.length < 2 || Math.abs(ends[0].ey - ends[1].ey) >= 14);

  const pickIndex = (clientX: number) => {
    const el = wrapRef.current;
    if (!el || n === 0) return null;
    const rel = clientX - el.getBoundingClientRect().left;
    const i = n <= 1 ? 0 : Math.round(((rel - left) / plotW) * (n - 1));
    return Math.min(n - 1, Math.max(0, i));
  };

  const onMove = (e: PointerEvent<HTMLDivElement>) => setActive(pickIndex(e.clientX));
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      setActive((a) => {
        const cur = a ?? n - 1;
        return Math.min(n - 1, Math.max(0, cur + (e.key === "ArrowLeft" ? -1 : 1)));
      });
    } else if (e.key === "Home") { e.preventDefault(); setActive(0); }
    else if (e.key === "End") { e.preventDefault(); setActive(n - 1); }
    else if (e.key === "Escape") setActive(null);
  };

  const activePoint = active != null ? points[active] : null;
  const tipLeft = active != null ? Math.min(Math.max(x(active), 80), width - 80) : 0;

  const summary = SERIES.map((s) => {
    const last = points[n - 1]?.[s.key];
    return `${s.name} ${last == null ? "no data" : `${last.toLocaleString("en-US")} views`} in ${points[n - 1]?.longLabel ?? ""}`;
  }).join("; ");

  return (
    <div className="[--viz-ig:#d0458f] [--viz-tt:#2a78d6] dark:[--viz-ig:#e0559f] dark:[--viz-tt:#3987e5]">
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted" aria-hidden>
        {SERIES.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <svg width="16" height="8" aria-hidden><line x1="1" y1="4" x2="15" y2="4" stroke={s.color} strokeWidth="2" strokeLinecap="round" /></svg>
            {s.name}
          </span>
        ))}
      </div>

      <div
        ref={wrapRef}
        className="relative w-full touch-pan-y select-none outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-md"
        tabIndex={hasData ? 0 : -1}
        role="group"
        aria-label={`${title}. ${summary}. Use left and right arrow keys to read each month.`}
        onPointerMove={hasData ? onMove : undefined}
        onPointerDown={hasData ? onMove : undefined}
        onPointerLeave={() => setActive(null)}
        onKeyDown={hasData ? onKey : undefined}
        onBlur={() => setActive(null)}
      >
        <svg width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} role="img" aria-labelledby={`${uid}-t ${uid}-d`} className="block max-w-full">
          <title id={`${uid}-t`}>{title}</title>
          <desc id={`${uid}-d`}>{summary}</desc>

          {ticks.map((t) => (
            <g key={t}>
              <line x1={left} x2={left + plotW} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} shapeRendering="crispEdges" />
              <text x={left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--muted)" style={{ fontVariantNumeric: "tabular-nums" }}>
                {tickText(t, top)}
              </text>
            </g>
          ))}

          {points.map((p, i) =>
            i % labelEvery === (n - 1) % labelEvery ? (
              <text key={p.month} x={x(i)} y={HEIGHT - 8} textAnchor={i === n - 1 ? "end" : i === 0 ? "start" : "middle"} fontSize={11} fill={i === active ? "var(--text)" : "var(--muted)"}>
                {p.label}
              </text>
            ) : null,
          )}

          {active != null && (
            <line x1={x(active)} x2={x(active)} y1={M.top} y2={M.top + plotH} stroke="var(--muted)" strokeWidth={1} shapeRendering="crispEdges" />
          )}

          {paths.map((s) => (
            <g key={s.key}>
              <path d={s.d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {s.isolated.map((i) => (
                <circle key={i} cx={x(i)} cy={y(points[i][s.key] as number)} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
              ))}
              {s.last >= 0 && !s.isolated.includes(s.last) && (
                <circle cx={x(s.last)} cy={y(points[s.last][s.key] as number)} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
              )}
              {active != null && points[active][s.key] != null && (
                <circle cx={x(active)} cy={y(points[active][s.key] as number)} r={5} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
              )}
            </g>
          ))}

          {showDirect &&
            ends.map((e) => (
              <text key={e.key} x={e.ex + 10} y={e.ey} dy="0.32em" fontSize={11} fill="var(--text)">
                <tspan fontWeight={600}>{formatNumber(points[e.last][e.key])}</tspan>
                <tspan fill="var(--muted)"> {e.name === "Instagram" ? "IG" : "TikTok"}</tspan>
              </text>
            ))}
        </svg>

        {!hasData && (
          <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-muted">
            No views recorded for these 12 months yet. Enter this month&apos;s numbers below.
          </div>
        )}

        {activePoint && (
          <div
            className="pointer-events-none absolute top-0 z-10 w-40 -translate-x-1/2 rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg"
            style={{ left: tipLeft }}
            aria-hidden
          >
            <p className="mb-1 font-medium text-muted">{activePoint.longLabel}</p>
            {SERIES.map((s) => (
              <p key={s.key} className="flex items-center gap-2">
                <svg width="12" height="8" aria-hidden><line x1="1" y1="4" x2="11" y2="4" stroke={s.color} strokeWidth="2" strokeLinecap="round" /></svg>
                <span className="font-semibold tabular-nums text-text">{activePoint[s.key] == null ? "—" : activePoint[s.key]!.toLocaleString("en-US")}</span>
                <span className="text-muted">{s.name}</span>
              </p>
            ))}
          </div>
        )}
      </div>

      <details className="mt-2 text-xs">
        <summary className="cursor-pointer text-muted hover:text-text pointer-coarse:py-3">Show as table</summary>
        <div className="relative mt-2 overflow-x-auto">
          <table className="w-full min-w-72 text-left tabular-nums">
            <caption className="sr-only">{title}</caption>
            <thead className="text-muted">
              <tr>
                <th scope="col" className="py-1 pr-3 font-medium">Month</th>
                {SERIES.map((s) => <th key={s.key} scope="col" className="py-1 pr-3 text-right font-medium">{s.name}</th>)}
              </tr>
            </thead>
            <tbody>
              {[...points].reverse().map((p) => (
                <tr key={p.month} className={cx("border-t border-border")}>
                  <th scope="row" className="py-1 pr-3 font-normal">{p.longLabel}</th>
                  {SERIES.map((s) => (
                    <td key={s.key} className="py-1 pr-3 text-right">{p[s.key] == null ? "—" : p[s.key]!.toLocaleString("en-US")}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
