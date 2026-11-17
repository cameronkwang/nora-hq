import type { ReactNode } from "react";
import { requireUser } from "@/lib/auth";
import { listClients } from "@/lib/data";
import { formatDate, relativeTime } from "@/lib/dates";
import { getCreatorStats, PLATFORM_LABEL, type PlatformSummary, type TopPost } from "@/lib/ops-creator";
import { instagramConfigured } from "@/lib/integrations/instagram";
import { tiktokConfigured } from "@/lib/integrations/tiktok";
import type { CreatorPlatform } from "@/lib/schema";
import { Card, EmptyState, PageHeader, Status, buttonClass, cx, formatNumber } from "@/components/ui";
import { CopyButton } from "@/components/copy-button";
import { StatsGrowthChart } from "@/components/stats-growth-chart";
import { StatsManualForm, StatsSyncButton, StatsTagSelect } from "@/components/stats-forms";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const DAYS = 90;
const CONNECT: Record<CreatorPlatform, string> = { instagram: "/api/oauth/instagram/start?purpose=creator", tiktok: "/api/oauth/tiktok/start" };

const GENDER: Record<string, string> = { F: "Women", M: "Men", U: "Unspecified" };
const pct = (r: number | null) => (r == null ? "—" : `${(r * 100).toFixed(r < 0.1 ? 1 : 0)}%`);

function Delta({ n, label }: { n: number | null; label: string }) {
  if (n == null) return null;
  const sign = n > 0 ? "+" : n < 0 ? "−" : "±";
  return (
    <span className="whitespace-nowrap">
      <span className={cx("tabular-nums", n > 0 ? "font-medium text-text" : "")}>{sign}{formatNumber(Math.abs(n))}</span> {label}
    </span>
  );
}

function Mini({ label, value, hint }: { label: string; value: ReactNode; hint?: string | null }) {
  return (
    <div className="min-w-0">
      <p className="eyebrow">{label}</p>
      <p className="mt-0.5 font-medium tabular-nums">{value}</p>
      {hint && <p className="meta [overflow-wrap:anywhere]">{hint}</p>}
    </div>
  );
}

/** Plain <a> so the OAuth start route is never prefetched. */
function ConnectButton({ p, again, disabled }: { p: CreatorPlatform; again?: boolean; disabled?: boolean }) {
  if (disabled) {
    return <span className={cx(buttonClass("secondary", "sm"), "pointer-events-none opacity-50")} aria-disabled>Connect {PLATFORM_LABEL[p]}</span>;
  }
  return <a href={CONNECT[p]} className={buttonClass(again ? "ghost" : "secondary", "sm")}>{again ? "Reconnect" : `Connect ${PLATFORM_LABEL[p]}`}</a>;
}

function PlatformCard({ s, ready }: { s: PlatformSummary; ready: boolean }) {
  const p = s.platform;
  const problem = s.connectionStatus && s.connectionStatus !== "ok";
  return (
    <section className="sec flex min-w-0 flex-col">
      <header className="sec-head">
        <h2 className="title min-w-0 truncate">
          {PLATFORM_LABEL[p]}
          {s.connectionLabel && <span className="meta">{s.connectionLabel}</span>}
        </h2>
        {s.connected ? (
          problem ? <Status tone={s.connectionStatus === "expired" ? "warn" : "danger"} small>{s.connectionStatus === "expired" ? "Expired" : "Problem"}</Status> : <Status tone="ok" small>Auto-sync</Status>
        ) : (
          <Status small>{s.followers != null ? "Logged by hand" : "Not connected"}</Status>
        )}
      </header>

      <div className="figure pt-2">
        <span className="eyebrow">Followers</span>
        <span className="value">{s.followers != null ? s.followers.toLocaleString("en-US") : "—"}</span>
        <span className="meta flex flex-wrap gap-x-4 gap-y-0.5">
          <Delta n={s.change7} label="in 7 days" />
          <Delta n={s.change30} label="in 30 days" />
          {s.change7 == null && s.change30 == null && s.followers != null && <span>Growth shows after a week of history.</span>}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-4 border-t border-border pt-3">
        <Mini label="Views, 28 days" value={formatNumber(s.views28)} hint={s.viewsNote} />
        <Mini label="Engagement" value={pct(s.engagementRate)} hint={s.engagementRate != null ? "last 10 posts" : null} />
        <Mini label="Posts this month" value={s.postsThisMonth ?? "—"} />
      </div>

      {(problem && s.connectionError) && <p className="status is-danger is-small mt-4 whitespace-normal">{s.connectionError}</p>}
      {s.missingScopes.length > 0 && (
        <p className="status is-warn is-small mt-4 whitespace-normal">
          Some permissions were turned off at sign-in ({s.missingScopes.join(", ")}). Reconnect and allow them for full stats.
        </p>
      )}

      <footer className="meta mt-4 flex flex-wrap items-center justify-between gap-2">
        <span>
          {s.lastSyncedAt ? <>Last synced {relativeTime(s.lastSyncedAt)}</> : s.followersDate ? <>Last logged {formatDate(s.followersDate)}</> : "No numbers yet"}
        </span>
        {(!s.connected || problem || s.missingScopes.length > 0) && <ConnectButton p={p} again={s.connected} disabled={!ready} />}
      </footer>
      {!ready && !s.connected && (
        <p className="hint">
          {p === "instagram" ? "Needs IG_APP_ID / IG_APP_SECRET" : "Needs TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET"} (docs/setup.md). Log numbers by hand below until then.
        </p>
      )}
    </section>
  );
}

function PostRow({ post, clients }: { post: TopPost; clients: Array<{ id: string; name: string }> }) {
  const stats: Array<[string, number | null]> = [
    ["views", post.views], ["likes", post.likes], ["comments", post.comments], ["shares", post.shares], ["saves", post.saves],
  ];
  return (
    <li className="flex gap-3 py-3">
      <a href={post.permalink ?? undefined} target="_blank" rel="noreferrer" className="relative block h-20 w-16 shrink-0 overflow-hidden rounded-sm bg-surface-2 sm:h-24 sm:w-[4.5rem]" aria-label="Open post">
        {post.thumbnailUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={post.thumbnailUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-full object-cover" />
        )}
      </a>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="line-clamp-2 min-w-0">{post.caption || <span className="text-muted">No caption</span>}</p>
          {post.permalink && (
            <a href={post.permalink} target="_blank" rel="noreferrer" className="link-quiet tap-target shrink-0">Open ↗</a>
          )}
        </div>
        <p className="meta">
          <span className={cx("status is-small", post.platform === "instagram" ? "is-ig" : "is-tt")}>
            {PLATFORM_LABEL[post.platform]}{post.mediaType ? ` ${post.mediaType}` : ""}
          </span>
          {post.postedAt ? ` · ${formatDate(post.postedAt)}` : ""}
        </p>
        <p className="meta flex flex-wrap gap-x-3 gap-y-0.5">
          {stats.filter(([, v]) => v != null).map(([k, v], i) => (
            <span key={k}><span className={cx("tabular-nums text-text", i === 0 && "font-medium")}>{formatNumber(v)}</span> {k}</span>
          ))}
        </p>
        {clients.length > 0 && <div className="max-w-xs"><StatsTagSelect mediaId={post.id} value={post.clientId} clients={clients} /></div>}
      </div>
    </li>
  );
}

/** Ranked bars (magnitude, one series): thin ink lines, the share in words at the end. */
function Bars({ title, rows, total }: { title: string; rows: Array<{ key: string; value: number }>; total: number }) {
  if (!rows.length) return null;
  const max = Math.max(...rows.map((r) => r.value));
  return (
    <div className="min-w-0">
      <p className="eyebrow mb-2">{title}</p>
      <ul className="g-hbars">
        {rows.map((r) => {
          const share = total > 0 ? r.value / total : null;
          return (
            <li key={r.key} title={`${r.key}: ${r.value.toLocaleString("en-US")}`}>
              <span className="truncate text-sm">{r.key}</span>
              <span className="min-w-0"><i style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} /></span>
              <span className="n">{share != null ? `${Math.round(share * 100)}%` : formatNumber(r.value)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default async function StatsPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireUser();
  const sp = await searchParams;
  const [stats, clients] = await Promise.all([getCreatorStats({ days: DAYS }), listClients()]);
  const ready = { instagram: instagramConfigured(), tiktok: tiktokConfigured() };
  const { instagram: ig, tiktok: tt } = stats.platforms;
  const anyConnected = ig.connected || tt.connected;
  const manualFor = { instagram: !ig.connected, tiktok: !tt.connected };
  const nothingYet = !anyConnected && ig.followers == null && tt.followers == null;
  const error = one(sp.error);
  const msg = one(sp.msg);
  const clientOpts = clients.map((c) => ({ id: c.id, name: c.name }));

  const kitLines = [stats.mediaKit.text, "", ...stats.mediaKit.numbers.map((n) => `${n.label}: ${n.value}`)].join("\n").trim();
  const cityTotal = stats.audience ? (ig.followers ?? stats.audience.cities.reduce((a, c) => a + c.value, 0)) : 0;
  const ageTotal = stats.audience ? stats.audience.ages.reduce((a, c) => a + c.value, 0) : 0;
  const genderTotal = stats.audience ? stats.audience.genders.reduce((a, c) => a + c.value, 0) : 0;

  const manual = (
    <Card title="Log today’s numbers">
      <p className="meta mb-4">Takes 20 seconds: open each app, copy the follower count (and views if you like). Saved for {formatDate(stats.today)}.</p>
      <StatsManualForm show={manualFor} />
    </Card>
  );

  return (
    <>
      <PageHeader
        title="My stats"
        subtitle="@noraeatsgood on Instagram and TikTok"
        actions={anyConnected ? <StatsSyncButton /> : undefined}
      />

      {error && <p role="status" className="notice mb-6"><span className="status is-danger">{error}</span></p>}
      {msg && !error && <p role="status" className="notice mb-6"><span className="status is-ok">{msg}</span></p>}

      <div className="grid gap-10 md:grid-cols-2 md:gap-x-16">
        <PlatformCard s={ig} ready={ready.instagram} />
        <PlatformCard s={tt} ready={ready.tiktok} />
      </div>

      {nothingYet && manual}

      {!nothingYet && (
        <Card title="Follower growth">
          <div className="grid gap-8 md:grid-cols-2 md:gap-x-16">
            <StatsGrowthChart title="Instagram" color="ig" points={stats.series.instagram} days={DAYS} />
            <StatsGrowthChart title="TikTok" color="tt" points={stats.series.tiktok} days={DAYS} />
          </div>
        </Card>
      )}

      <div className="cols">
        <div className="min-w-0">
          <Card title="Top posts, last 30 days" padded={false}>
            {stats.topPosts.length === 0 ? (
              <EmptyState title="No posts synced yet">Top posts appear once Instagram or TikTok is connected.</EmptyState>
            ) : (
              <ul className="list">
                {stats.topPosts.map((p) => <PostRow key={p.id} post={p} clients={clientOpts} />)}
              </ul>
            )}
          </Card>
        </div>

        <div className="min-w-0">
          <Card title="Media kit summary" actions={kitLines ? <CopyButton text={kitLines} size="sm" variant="ghost" /> : undefined}>
            {stats.mediaKit.text ? (
              <div className="flex flex-col gap-3">
                <p>{stats.mediaKit.text}</p>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border pt-3">
                  {stats.mediaKit.numbers.map((n) => (
                    <div key={n.label} className="min-w-0">
                      <dt className="meta [overflow-wrap:anywhere]">{n.label}</dt>
                      <dd className="font-medium tabular-nums [overflow-wrap:anywhere]">{n.value}</dd>
                    </div>
                  ))}
                </dl>
                <p className="hint">Paste into a pitch. Claude uses the same numbers when drafting collab outreach.</p>
              </div>
            ) : (
              <EmptyState title="Nothing to summarize yet">Log or sync follower counts first.</EmptyState>
            )}
          </Card>

          <Card title="Audience (Instagram)">
            {stats.audience && (stats.audience.cities.length || stats.audience.ages.length) ? (
              <div className="flex flex-col gap-5">
                <Bars title="Top cities" rows={stats.audience.cities} total={cityTotal} />
                <Bars title="Age" rows={stats.audience.ages} total={ageTotal} />
                {stats.audience.genders.length > 0 && (
                  <p className="meta">
                    {stats.audience.genders.map((g) => `${GENDER[g.key] ?? g.key} ${genderTotal ? Math.round((g.value / genderTotal) * 100) : 0}%`).join(" · ")}
                  </p>
                )}
                <p className="meta">Updated weekly · last {relativeTime(stats.audience.capturedAt)}</p>
              </div>
            ) : (
              <EmptyState title="No audience data yet">
                {ig.connected ? "Instagram shares this weekly once the account has 100+ followers." : "Connect Instagram to see top cities and ages, handy for local restaurant pitches."}
              </EmptyState>
            )}
          </Card>
        </div>
      </div>

      {!nothingYet && (manualFor.instagram || manualFor.tiktok) && (
        <details className="sec g-fold">
          <summary className="sec-head">
            <span className="title">Log today&apos;s numbers by hand</span>
            <svg viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M6 3.5 10.5 8 6 12.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </summary>
          <div className="sec-body">
            <StatsManualForm show={manualFor} />
          </div>
        </details>
      )}
    </>
  );
}
