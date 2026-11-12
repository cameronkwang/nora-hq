import type { ReactNode } from "react";
import { DEFAULT_RATE_LINE } from "@/lib/collab-copy";

/**
 * Nora's media kit, as one presentational component. Used by the public page (/kit) and the live preview on
 * /kit-settings, so what she previews is exactly what businesses see. No hooks, no server imports.
 */

export type MediaKitSettings = {
  enabled: boolean;
  headline: string;
  bio: string;
  rateLine: string;
  showRate: boolean;
  showPastCollabs: boolean;
  pastCollabs: string[];
  contactEmail: string;
  showCities: boolean;
  /** "Content style" chips, e.g. "Restaurant features". */
  styles: string[];
};

export const KIT_DEFAULTS: MediaKitSettings = {
  enabled: false,
  headline: "Food creator sharing spots worth the trip",
  bio: "I'm Nora — I film honest, crave-worthy food content for people who love finding their next favorite spot. Restaurants, cafés, bakeries and food brands work with me to reach hungry locals.",
  rateLine: DEFAULT_RATE_LINE,
  showRate: true,
  showPastCollabs: false,
  pastCollabs: [],
  contactEmail: "",
  showCities: true,
  styles: ["Restaurant features", "Reels & TikToks", "Local food finds", "Honest reviews", "New menu launches"],
};

/** The numbers the kit shows. Plain JSON so it can cross to the client preview. */
export type KitStats = {
  igFollowers: number | null;
  ttFollowers: number | null;
  igAvgViews: number | null;
  ttAvgViews: number | null;
  /** 0..1 */
  igEngagement: number | null;
  ttEngagement: number | null;
  cities: string[];
  /** YYYY-MM-DD the numbers are from. */
  asOf: string | null;
};

export type KitIdentity = { name: string; igHandle: string | null; ttHandle: string | null };

/** 980 → "980", 8,240 → "8.2K", 23,480 → "23.5K", 235,000 → "235K", 1,240,000 → "1.2M". */
export function compactNumber(n: number): string {
  const strip = (s: string) => s.replace(/\.0$/, "");
  if (n >= 1_000_000) return `${strip((n / 1_000_000).toFixed(1))}M`;
  if (n >= 100_000) return `${Math.round(n / 1000)}K`;
  if (n >= 1_000) return `${strip((Math.round(n / 100) / 10).toFixed(1))}K`;
  return Math.round(n).toLocaleString("en-US");
}

export function percent(r: number): string {
  return `${(r * 100).toFixed(r < 0.1 ? 1 : 0)}%`;
}

export function formatAsOf(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-border bg-surface p-4">
      <p className="text-[28px] font-semibold leading-none tracking-tight tabular-nums sm:text-3xl">{value}</p>
      <p className="mt-2 text-sm font-medium">{label}</p>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted">{title}</h2>
      {children}
    </section>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return <li className="rounded-full border border-border bg-surface px-3 py-1.5 text-sm">{children}</li>;
}

export function KitView({
  settings: s,
  stats,
  identity,
  collabHref = "/collab",
  preview = false,
}: {
  settings: MediaKitSettings;
  stats: KitStats;
  identity: KitIdentity;
  collabHref?: string;
  /** In the settings preview, links don't navigate away. */
  preview?: boolean;
}) {
  const handle = identity.igHandle ?? identity.ttHandle ?? "noraeatsgood";
  const tiles: Array<{ label: string; value: string; sub?: string }> = [];
  if (stats.igFollowers != null) tiles.push({ label: "Instagram followers", value: compactNumber(stats.igFollowers) });
  if (stats.ttFollowers != null) tiles.push({ label: "TikTok followers", value: compactNumber(stats.ttFollowers) });
  if (stats.igAvgViews != null) tiles.push({ label: "Avg views per reel", value: compactNumber(stats.igAvgViews), sub: "Last 10 reels" });
  if (stats.ttAvgViews != null) tiles.push({ label: "Avg views per TikTok", value: compactNumber(stats.ttAvgViews), sub: "Last 10 videos" });
  const eng = [
    stats.igEngagement != null ? { p: "Instagram", r: stats.igEngagement } : null,
    stats.ttEngagement != null ? { p: "TikTok", r: stats.ttEngagement } : null,
  ].filter((x): x is { p: string; r: number } => !!x);
  if (eng.length) {
    const best = eng.reduce((a, b) => (b.r > a.r ? b : a));
    const other = eng.find((e) => e !== best);
    tiles.push({ label: "Engagement rate", value: percent(best.r), sub: other ? `${best.p} · ${other.p} ${percent(other.r)}` : `${best.p}, recent posts` });
  }
  const cities = s.showCities ? stats.cities.slice(0, 3) : [];
  const past = s.showPastCollabs ? s.pastCollabs.filter(Boolean) : [];
  const styles = s.styles.filter(Boolean);
  const email = s.contactEmail.trim();
  const noNav = preview ? { onClick: (e: { preventDefault: () => void }) => e.preventDefault(), tabIndex: -1 } : {};

  return (
    <div className="mx-auto w-full max-w-2xl">
      <header className="text-center">
        <span aria-hidden className="mx-auto mb-4 flex size-20 items-center justify-center rounded-full bg-accent text-3xl font-semibold text-accent-fg shadow-sm">
          {identity.name.trim().charAt(0).toUpperCase() || "N"}
        </span>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Media kit</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">{identity.name}</h1>
        <p className="mt-1 flex flex-wrap items-center justify-center gap-x-3 text-[15px] font-medium">
          {identity.igHandle && (
            <a href={`https://www.instagram.com/${identity.igHandle}/`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-ig hover:underline" {...noNav}>
              @{identity.igHandle} · Instagram
            </a>
          )}
          {identity.ttHandle && (
            <a href={`https://www.tiktok.com/@${identity.ttHandle}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-tt hover:underline" {...noNav}>
              @{identity.ttHandle} · TikTok
            </a>
          )}
          {!identity.igHandle && !identity.ttHandle && <span className="text-accent">@{handle}</span>}
        </p>
        {s.headline.trim() && <p className="mx-auto mt-4 max-w-md text-lg font-medium leading-snug">{s.headline}</p>}
        {s.bio.trim() && <p className="mx-auto mt-3 max-w-lg whitespace-pre-line text-[16px] leading-relaxed text-muted">{s.bio}</p>}
      </header>

      {tiles.length > 0 ? (
        <Section title="The numbers">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {tiles.map((t) => <StatTile key={t.label} {...t} />)}
          </div>
          {stats.asOf && <p className="mt-2 text-xs text-muted">As of {formatAsOf(stats.asOf)}</p>}
        </Section>
      ) : preview ? (
        <Section title="The numbers">
          <p className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted">No numbers yet — connect or log them on My stats and they show up here.</p>
        </Section>
      ) : null}

      {cities.length > 0 && (
        <Section title="Top audience cities">
          <ol className="flex flex-wrap gap-2">
            {cities.map((c, i) => (
              <li key={c} className="flex items-center gap-2 rounded-full bg-surface-2 px-3 py-1.5 text-sm">
                <span className="text-xs font-semibold tabular-nums text-muted">{i + 1}</span>
                {c}
              </li>
            ))}
          </ol>
          <p className="mt-2 text-xs text-muted">From Instagram audience insights.</p>
        </Section>
      )}

      {styles.length > 0 && (
        <Section title="Content style">
          <ul className="flex flex-wrap gap-2">{styles.map((x) => <Chip key={x}>{x}</Chip>)}</ul>
        </Section>
      )}

      {past.length > 0 && (
        <Section title="Past collabs">
          <ul className="flex flex-wrap gap-2">{past.map((x) => <Chip key={x}>{x}</Chip>)}</ul>
        </Section>
      )}

      <section className="mt-10 rounded-3xl border border-border bg-surface p-5 text-center shadow-sm sm:p-8">
        <h2 className="text-xl font-semibold tracking-tight">Let’s work together</h2>
        {s.showRate && s.rateLine.trim() && <p className="mx-auto mt-2 max-w-md text-[16px] leading-relaxed">{s.rateLine}</p>}
        <div className="mt-5 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
          <a href={collabHref} className="inline-flex min-h-12 items-center justify-center rounded-xl bg-accent px-6 text-base font-semibold text-accent-fg hover:opacity-90" {...noNav}>
            Start a collab
          </a>
          {email && (
            <a href={`mailto:${email}`} className="inline-flex min-h-12 items-center justify-center rounded-xl border border-border px-6 text-base font-medium hover:bg-surface-2" {...noNav}>
              Email {identity.name.split(" ")[0]}
            </a>
          )}
        </div>
        {email && <p className="mt-3 break-all text-sm text-muted">{email}</p>}
        <p className="mx-auto mt-4 max-w-sm text-xs leading-relaxed text-muted">
          Sponsored and gifted content is always clearly disclosed. Reviews are honest — a collab doesn’t guarantee positive coverage.
        </p>
      </section>
    </div>
  );
}
