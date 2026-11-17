import Link from "next/link";
import type { ComponentProps, CSSProperties, ReactNode } from "react";

/**
 * Shared presentational primitives. Server-component safe (no hooks).
 * They draw the "Ink" system (docs/design.md) with the shared classes in globals.css: sections on an ink rule
 * instead of cards, a dot and plain words instead of coloured pills, one accent action per screen.
 */

export function cx(...c: Array<string | false | null | undefined>) {
  return c.filter(Boolean).join(" ");
}

/** Page title (serif), actions on its baseline, one muted line under it. `crumb` is the optional way back above the title. */
export function PageHeader({ title, subtitle, actions, crumb }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; crumb?: ReactNode }) {
  return (
    <header className="page-head">
      {crumb && <p className="crumb">{crumb}</p>}
      <div className="head-row">
        <h1 className="display">{title}</h1>
        {actions && <div className="head-actions">{actions}</div>}
      </div>
      {subtitle && <p className="sub">{subtitle}</p>}
    </header>
  );
}

/**
 * A section: an ink rule, a serif title with one quiet action on the right, then the content. No box.
 * (Still called Card at ~100 call sites; `Section` is the same component.) `padded` only decides whether the
 * content gets a little air under the title: pass `padded={false}` for a list, whose rows bring their own.
 */
export function Card({ title, actions, children, className, padded = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean }) {
  const head = Boolean(title || actions);
  return (
    <section className={cx("sec", !head && "is-untitled", className)}>
      {head && (
        <header className="sec-head">
          <h2 className="title">{title}</h2>
          {actions}
        </header>
      )}
      <div className={head && padded ? "sec-body" : undefined}>{children}</div>
    </section>
  );
}
export const Section = Card;

export type Tone = "neutral" | "accent" | "ok" | "warn" | "danger" | "info" | "ink";
const toneCls: Record<Tone, string> = {
  neutral: "is-idle",
  accent: "is-accent",
  ok: "is-ok",
  warn: "is-warn",
  danger: "is-danger",
  info: "is-info",
  ink: "is-ink",
};

/**
 * A state: a 7px dot in the tone's colour and plain words. `tone="neutral"` is the hollow dot ("nothing to do");
 * `tone="ink"` is a solid ink dot, for a settled state that is neither good news nor a warning (a post that is ready).
 */
export function Status({ tone = "neutral", small, children, className }: { tone?: Tone; small?: boolean; children: ReactNode; className?: string }) {
  return <span className={cx("status", toneCls[tone], small && "is-small", className)}>{children}</span>;
}

/** A fact about a row (Free, Creator, Inactive, From Oct): outlined, tiny caps, never coloured. `bare` drops the gap it keeps after a name. */
export function Tag({ children, className, bare }: { children: ReactNode; className?: string; bare?: boolean }) {
  return <span className={cx("tag", bare && "is-bare", className)}>{children}</span>;
}

/** A number that needs you: a cinnabar numeral, no pill. */
export function Count({ n, className, label }: { n: number; className?: string; label?: string }) {
  return (
    <span className={cx("count", className)} aria-label={label}>
      {n > 99 ? "99+" : n}
    </span>
  );
}

/**
 * The old soft pill. With a tone it is a Status (dot + words); without one it is a Tag (a fact).
 * New code should use <Status> or <Tag> directly.
 */
export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  if (tone === "neutral") return <Tag bare className={className}>{children}</Tag>;
  return <Status tone={tone} small className={className}>{children}</Status>;
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
  return <Status tone={STATUS_TONE[status] ?? "neutral"} small>{humanize(status)}</Status>;
}

const PLATFORM_META: Record<string, { label: string; cls: string }> = {
  instagram: { label: "Instagram", cls: "is-ig" },
  facebook: { label: "Facebook", cls: "is-facebook" },
  tiktok: { label: "TikTok", cls: "is-tt" },
  google: { label: "Google", cls: "is-google" },
  email: { label: "Email", cls: "is-info" },
  instagram_dm: { label: "IG DM", cls: "is-ig" },
  tiktok_dm: { label: "TikTok DM", cls: "is-tt" },
  other: { label: "Other", cls: "" },
};

/**
 * A platform: its colour is a dot before the name; the name is plain text in the colour of the line it sits in.
 * Meta size by default (it mostly sits in a meta line); `inherit` takes the size of the text around it.
 */
export function PlatformTag({ platform, inherit, className }: { platform: string | null | undefined; inherit?: boolean; className?: string }) {
  if (!platform) return null;
  const m = PLATFORM_META[platform] ?? { label: humanize(platform), cls: "" };
  return <span className={cx("status", m.cls, !inherit && "is-small", className)}>{m.label}</span>;
}

type BtnVariant = "primary" | "secondary" | "ghost" | "danger";
/** One primary (cinnabar) per screen; secondary is the outlined default; ghost is a quiet text button. */
export function buttonClass(variant: BtnVariant = "secondary", size: "sm" | "md" = "md") {
  return cx("btn", `btn-${variant}`, size === "sm" && "btn-sm");
}

export function Button({ variant = "secondary", size = "md", className, ...props }: ComponentProps<"button"> & { variant?: BtnVariant; size?: "sm" | "md" }) {
  return <button {...props} className={cx(buttonClass(variant, size), className)} />;
}

export function LinkButton({ variant = "secondary", size = "md", className, ...props }: ComponentProps<typeof Link> & { variant?: BtnVariant; size?: "sm" | "md" }) {
  return <Link {...props} className={cx(buttonClass(variant, size), className)} />;
}

/** Two plain lines where the rows would be. No box. */
export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <p>{title}</p>
      {children && <div>{children}</div>}
    </div>
  );
}

/** A figure: caps label, the number in the serif, one meta line. No box; put several in a `figures` row. */
export function Stat({ label, value, hint }: { label: ReactNode; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="figure">
      <span className="eyebrow">{label}</span>
      <span className="value">{value}</span>
      {hint && <span className="meta">{hint}</span>}
    </div>
  );
}
export const Figure = Stat;

/**
 * Progress in ink: one segment per planned item up to 12, a single thin bar above that (or when there is no target).
 * Always put the words next to it ("3 of 8").
 */
export function ProgressBar({ value, max, className }: { value: number; max: number; className?: string }) {
  const a11y = { role: "progressbar", "aria-valuenow": value, "aria-valuemin": 0, "aria-valuemax": max } as const;
  if (max > 0 && max <= 12) {
    const done = Math.max(0, Math.min(max, Math.round(value)));
    return (
      <div className={cx("meter", className)} style={{ "--n": max } as CSSProperties} {...a11y}>
        {Array.from({ length: max }, (_, i) => (
          <i key={i} className={i < done ? "on" : undefined} />
        ))}
      </div>
    );
  }
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : value > 0 ? 100 : 0;
  return (
    <div className={cx("bar", className)} {...a11y}>
      <i style={{ width: `${pct}%` }} />
    </div>
  );
}
export const Meter = ProgressBar;

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
