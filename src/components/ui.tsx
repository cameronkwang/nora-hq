import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

/** Shared presentational primitives. Server-component safe (no hooks). */

export function cx(...c: Array<string | false | null | undefined>) {
  return c.filter(Boolean).join(" ");
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className, padded = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={cx("rounded-xl border border-border bg-surface", className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          {actions}
        </header>
      )}
      <div className={padded ? "p-4" : ""}>{children}</div>
    </section>
  );
}

type Tone = "neutral" | "accent" | "ok" | "warn" | "danger" | "info";
const toneCls: Record<Tone, string> = {
  neutral: "bg-surface-2 text-muted",
  accent: "bg-accent-soft text-accent",
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
};

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", toneCls[tone], className)}>
      {children}
    </span>
  );
}

const STATUS_TONE: Record<string, Tone> = {
  todo: "neutral", in_progress: "info", needs_review: "warn", blocked: "danger", done: "ok",
  new: "accent", archived: "neutral",
  approved: "ok", rejected: "neutral", sent: "ok", failed: "danger",
  idea: "neutral", drafted: "info", scheduled: "info", published: "ok",
  sourced: "neutral", shortlisted: "neutral", contacted: "info", followed_up: "info", replied: "accent",
  negotiating: "accent", agreed: "ok", visit_scheduled: "ok", posted: "ok", declined: "neutral", no_response: "neutral",
  ok: "ok", error: "danger", expired: "warn",
};

export function humanize(s: string) {
  return s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? "neutral"}>{humanize(status)}</Badge>;
}

const PLATFORM_META: Record<string, { label: string; cls: string }> = {
  instagram: { label: "Instagram", cls: "text-ig" },
  facebook: { label: "Facebook", cls: "text-facebook" },
  tiktok: { label: "TikTok", cls: "text-tt" },
  google: { label: "Google", cls: "text-google" },
  email: { label: "Email", cls: "text-info" },
  instagram_dm: { label: "IG DM", cls: "text-ig" },
  tiktok_dm: { label: "TikTok DM", cls: "text-tt" },
  other: { label: "Other", cls: "text-muted" },
};

export function PlatformTag({ platform }: { platform: string | null | undefined }) {
  if (!platform) return null;
  const m = PLATFORM_META[platform] ?? { label: humanize(platform), cls: "text-muted" };
  return (
    <span className={cx("inline-flex items-center gap-1 text-xs font-medium", m.cls)}>
      <span aria-hidden className="inline-block size-1.5 rounded-full bg-current" />
      {m.label}
    </span>
  );
}

type BtnVariant = "primary" | "secondary" | "ghost" | "danger";
const btnCls: Record<BtnVariant, string> = {
  primary: "bg-accent text-accent-fg hover:opacity-90",
  secondary: "border border-border bg-surface hover:bg-surface-2",
  ghost: "hover:bg-surface-2",
  danger: "border border-border bg-surface text-danger hover:bg-danger-soft",
};
export function buttonClass(variant: BtnVariant = "secondary", size: "sm" | "md" = "md") {
  return cx(
    "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition disabled:opacity-50 disabled:pointer-events-none",
    // .btn / .btn-sm (globals.css) raise the height to a 44px / 40px tap target on touch screens.
    size === "sm" ? "btn-sm px-2.5 py-1 text-xs" : "btn px-3.5 py-2 text-sm",
    btnCls[variant],
  );
}

export function Button({ variant = "secondary", size = "md", className, ...props }: ComponentProps<"button"> & { variant?: BtnVariant; size?: "sm" | "md" }) {
  return <button {...props} className={cx(buttonClass(variant, size), className)} />;
}

export function LinkButton({ variant = "secondary", size = "md", className, ...props }: ComponentProps<typeof Link> & { variant?: BtnVariant; size?: "sm" | "md" }) {
  return <Link {...props} className={cx(buttonClass(variant, size), className)} />;
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center">
      <p className="text-sm font-medium">{title}</p>
      {children && <div className="mt-1 text-sm text-muted">{children}</div>}
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : value > 0 ? 100 : 0;
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={value} aria-valuemax={max}>
      <div className={cx("h-full rounded-full", pct >= 100 ? "bg-ok" : "bg-accent")} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function formatNumber(n: number | null | undefined): string {
  if (n == null) return "—";
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (Math.abs(n) >= 100_000) return `${Math.round(n / 1000)}K`;
  if (Math.abs(n) >= 1_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return n.toLocaleString("en-US");
}

export function clientLabel(c: { name: string; location: string | null }) {
  return c.location ? `${c.name} · ${c.location}` : c.name;
}
