"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Follower growth for one platform: a single 2px line with a 10% wash, an end-dot + end label, a recessive
 * hairline grid, and a crosshair tooltip that snaps to the nearest day. One series per chart (small
 * multiples), so the card title names it and no legend box is needed. A table view sits underneath.
 */

type Point = { date: string; followers: number };

const H = 168;
const PAD = { top: 14, right: 52, bottom: 22, left: 44 };

function fmt(n: number) {
  if (Math.abs(n) >= 10_000) return `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1).replace(/\.0$/, "")}K`;
  return n.toLocaleString("en-US");
}
function fmtDate(d: string) {
  return new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
const dayNum = (d: string) => Math.floor(Date.parse(`${d}T12:00:00Z`) / 86_400_000);

/** 3–4 clean ticks spanning [lo, hi]. */
function ticks(lo: number, hi: number): number[] {
  const span = Math.max(1, hi - lo);
  const raw = span / 3;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const start = Math.floor(lo / step) * step;
  const out: number[] = [];
  for (let v = start; v <= hi + step * 0.001; v += step) out.push(Math.round(v));
  if (out[out.length - 1] < hi) out.push(Math.round(out[out.length - 1] + step));
  return out;
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    setW(Math.round(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

export function StatsGrowthChart({ title, points, color, days }: { title: string; points: Point[]; color: "ig" | "tt"; days: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const stroke = color === "ig" ? "var(--ig)" : "var(--tt)";

  const geo = useMemo(() => {
    if (points.length === 0 || width < 120) return null;
    const lo0 = Math.min(...points.map((p) => p.followers));
    const hi0 = Math.max(...points.map((p) => p.followers));
    const padY = Math.max(1, Math.round((hi0 - lo0) * 0.15) || Math.round(hi0 * 0.01) || 1);
    const t = ticks(Math.max(0, lo0 - padY), hi0 + padY);
    const lo = t[0];
    const hi = t[t.length - 1];
    const last = dayNum(points[points.length - 1].date);
    const first = Math.min(dayNum(points[0].date), last - (days - 1));
    const iw = width - PAD.left - PAD.right;
    const ih = H - PAD.top - PAD.bottom;
    const x = (d: string) => PAD.left + ((dayNum(d) - first) / Math.max(1, last - first)) * iw;
    const y = (v: number) => PAD.top + (1 - (v - lo) / Math.max(1, hi - lo)) * ih;
    const xy = points.map((p) => [x(p.date), y(p.followers)] as const);
    const line = xy.map(([a, b], i) => `${i ? "L" : "M"}${a.toFixed(1)},${b.toFixed(1)}`).join("");
    const area = `${line}L${xy[xy.length - 1][0].toFixed(1)},${PAD.top + ih}L${xy[0][0].toFixed(1)},${PAD.top + ih}Z`;
    const firstDate = new Date((first) * 86_400_000).toISOString().slice(0, 10);
    return { t, y, xy, line, area, ih, iw, firstDate };
  }, [points, width, days]);

  const onMove = (clientX: number, rect: DOMRect) => {
    if (!geo) return;
    const px = clientX - rect.left;
    let best = 0;
    for (let i = 1; i < geo.xy.length; i++) if (Math.abs(geo.xy[i][0] - px) < Math.abs(geo.xy[best][0] - px)) best = i;
    setHover(best);
  };

  const last = points[points.length - 1];
  const h = hover != null && geo ? { p: points[hover], xy: geo.xy[hover] } : null;

  return (
    <figure className="min-w-0">
      <figcaption className="mb-2 flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold">{title}</span>
        <span className="text-xs text-muted">Followers, last {days} days</span>
      </figcaption>
      <div ref={ref} className="relative">
        {points.length < 2 ? (
          <div className="flex h-[168px] items-center justify-center rounded-lg border border-dashed border-border px-4 text-center text-sm text-muted">
            {points.length === 0 ? "No follower history yet." : "One day logged — the line starts tomorrow."}
          </div>
        ) : geo ? (
          <svg
            width={width}
            height={H}
            role="img"
            aria-label={`${title}: ${fmt(points[0].followers)} to ${fmt(last.followers)} followers between ${fmtDate(points[0].date)} and ${fmtDate(last.date)}`}
            className="block touch-pan-y select-none"
            onPointerMove={(e) => onMove(e.clientX, e.currentTarget.getBoundingClientRect())}
            onPointerDown={(e) => onMove(e.clientX, e.currentTarget.getBoundingClientRect())}
            onPointerLeave={() => setHover(null)}
            tabIndex={0}
            onFocus={() => setHover(points.length - 1)}
            onBlur={() => setHover(null)}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft") setHover((i) => Math.max(0, (i ?? points.length - 1) - 1));
              if (e.key === "ArrowRight") setHover((i) => Math.min(points.length - 1, (i ?? 0) + 1));
            }}
          >
            {geo.t.map((v) => (
              <g key={v}>
                <line x1={PAD.left} x2={width - PAD.right} y1={geo.y(v)} y2={geo.y(v)} stroke="var(--border)" strokeWidth={1} shapeRendering="crispEdges" />
                <text x={PAD.left - 6} y={geo.y(v)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--muted)" className="tabular-nums">{fmt(v)}</text>
              </g>
            ))}
            <text x={PAD.left} y={H - 4} fontSize={11} fill="var(--muted)">{fmtDate(geo.firstDate)}</text>
            <text x={width - PAD.right} y={H - 4} fontSize={11} fill="var(--muted)" textAnchor="end">{fmtDate(last.date)}</text>
            <path d={geo.area} fill={stroke} opacity={0.1} />
            <path d={geo.line} fill="none" stroke={stroke} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {/* End dot with a surface ring + direct end label. */}
            <circle cx={geo.xy[geo.xy.length - 1][0]} cy={geo.xy[geo.xy.length - 1][1]} r={4} fill={stroke} stroke="var(--surface)" strokeWidth={2} />
            <text x={geo.xy[geo.xy.length - 1][0] + 8} y={geo.xy[geo.xy.length - 1][1]} dy="0.32em" fontSize={12} fontWeight={600} fill="var(--text)" className="tabular-nums">
              {fmt(last.followers)}
            </text>
            {h && (
              <g pointerEvents="none">
                <line x1={h.xy[0]} x2={h.xy[0]} y1={PAD.top} y2={PAD.top + geo.ih} stroke="var(--muted)" strokeWidth={1} opacity={0.6} />
                <circle cx={h.xy[0]} cy={h.xy[1]} r={4} fill={stroke} stroke="var(--surface)" strokeWidth={2} />
              </g>
            )}
          </svg>
        ) : (
          <div className="h-[168px]" />
        )}
        {h && geo && (
          <div
            role="status"
            className="pointer-events-none absolute top-0 z-10 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs shadow-md"
            style={{ left: Math.min(Math.max(0, h.xy[0] - 60), width - 128), width: 128 }}
          >
            <p className="flex items-center gap-1.5">
              <span aria-hidden className="inline-block h-0.5 w-3 rounded" style={{ background: stroke }} />
              <span className="text-sm font-semibold tabular-nums">{h.p.followers.toLocaleString("en-US")}</span>
            </p>
            <p className="text-muted">{fmtDate(h.p.date)}</p>
          </div>
        )}
      </div>
      {points.length > 0 && (
        <details className="mt-2 text-xs">
          <summary className="inline-flex min-h-11 cursor-pointer items-center text-muted hover:text-text md:min-h-0">Show table</summary>
          <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-border">
            <table className="w-full text-left tabular-nums">
              <thead className="sticky top-0 bg-surface-2 text-muted">
                <tr><th className="px-3 py-1.5 font-medium">Date</th><th className="px-3 py-1.5 text-right font-medium">Followers</th></tr>
              </thead>
              <tbody>
                {[...points].reverse().map((p) => (
                  <tr key={p.date} className="border-t border-border">
                    <td className="px-3 py-1">{fmtDate(p.date)}</td>
                    <td className="px-3 py-1 text-right">{p.followers.toLocaleString("en-US")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </figure>
  );
}
