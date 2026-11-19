import { DEFAULT_RATE_LINE } from "@/lib/collab-copy";
import { EmptyState, Figure, Section, buttonClass, cx } from "./ui";

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
  const figures: Array<{ label: string; value: string; sub?: string }> = [];
  if (stats.igFollowers != null) figures.push({ label: "Instagram followers", value: compactNumber(stats.igFollowers) });
  if (stats.ttFollowers != null) figures.push({ label: "TikTok followers", value: compactNumber(stats.ttFollowers) });
  if (stats.igAvgViews != null) figures.push({ label: "Avg views per reel", value: compactNumber(stats.igAvgViews), sub: "Last 10 reels" });
  if (stats.ttAvgViews != null) figures.push({ label: "Avg views per TikTok", value: compactNumber(stats.ttAvgViews), sub: "Last 10 videos" });
  const eng = [
    stats.igEngagement != null ? { p: "Instagram", r: stats.igEngagement } : null,
    stats.ttEngagement != null ? { p: "TikTok", r: stats.ttEngagement } : null,
  ].filter((x): x is { p: string; r: number } => !!x);
  if (eng.length) {
    const best = eng.reduce((a, b) => (b.r > a.r ? b : a));
    const other = eng.find((e) => e !== best);
    figures.push({ label: "Engagement rate", value: percent(best.r), sub: other ? `${best.p} · ${other.p} ${percent(other.r)}` : `${best.p}, recent posts` });
  }
  const cities = s.showCities ? stats.cities.slice(0, 3) : [];
  const past = s.showPastCollabs ? s.pastCollabs.filter(Boolean) : [];
  const styles = s.styles.filter(Boolean);
  const email = s.contactEmail.trim();
  const noNav = preview ? { onClick: (e: { preventDefault: () => void }) => e.preventDefault(), tabIndex: -1 } : {};

  return (
    <div className="mx-auto w-full max-w-2xl">
      <header>
        <p className="eyebrow">Media kit</p>
        <h1 className="display mt-2 [overflow-wrap:anywhere]">{identity.name}</h1>
        <p className="mt-2 flex flex-wrap gap-x-6">
          {identity.igHandle && (
            <a href={`https://www.instagram.com/${identity.igHandle}/`} target="_blank" rel="noopener noreferrer" className="status is-ig min-h-11 items-center hover:underline md:min-h-0" {...noNav}>
              @{identity.igHandle} · Instagram
            </a>
          )}
          {identity.ttHandle && (
            <a href={`https://www.tiktok.com/@${identity.ttHandle}`} target="_blank" rel="noopener noreferrer" className="status is-tt min-h-11 items-center hover:underline md:min-h-0" {...noNav}>
              @{identity.ttHandle} · TikTok
            </a>
          )}
          {!identity.igHandle && !identity.ttHandle && <span>@{handle}</span>}
        </p>
        {s.headline.trim() && <p className="title mt-6">{s.headline}</p>}
        {s.bio.trim() && <p className="mt-2 whitespace-pre-line text-muted">{s.bio}</p>}
      </header>

      {figures.length > 0 ? (
        <Section title="The numbers">
          <div className="figures">
            {figures.map((t) => <Figure key={t.label} label={t.label} value={t.value} hint={t.sub} />)}
          </div>
          {stats.asOf && <p className="meta mt-4">As of {formatAsOf(stats.asOf)}</p>}
        </Section>
      ) : preview ? (
        <Section title="The numbers">
          <EmptyState title="No numbers yet">Connect or log them on My stats and they show up here.</EmptyState>
        </Section>
      ) : null}

      {cities.length > 0 && (
        <Section title="Top audience cities">
          <ol className="g-words">
            {cities.map((c, i) => (
              <li key={c}>
                <span className="n">{i + 1}</span>
                {c}
              </li>
            ))}
          </ol>
          <p className="meta mt-2">From Instagram audience insights.</p>
        </Section>
      )}

      {styles.length > 0 && (
        <Section title="Content style">
          <ul className="g-words">{styles.map((x) => <li key={x}>{x}</li>)}</ul>
        </Section>
      )}

      {past.length > 0 && (
        <Section title="Past collabs">
          <ul className="g-words">{past.map((x) => <li key={x}>{x}</li>)}</ul>
        </Section>
      )}

      <Section title="Let’s work together">
        {s.showRate && s.rateLine.trim() && <p className="font-medium">{s.rateLine}</p>}
        <div className="mt-5 flex flex-wrap gap-3">
          <a href={collabHref} className={cx(buttonClass("primary"), "max-sm:flex-1")} {...noNav}>
            Start a collab
          </a>
          {email && (
            <a href={`mailto:${email}`} className={cx(buttonClass("secondary"), "max-sm:flex-1")} {...noNav}>
              Email {identity.name.split(" ")[0]}
            </a>
          )}
        </div>
        {email && <p className="meta mt-3 break-all">{email}</p>}
        <p className="meta mt-6">
          Sponsored and gifted content is always clearly disclosed. Reviews are honest: a collab doesn’t guarantee positive coverage.
        </p>
      </Section>
    </div>
  );
}
