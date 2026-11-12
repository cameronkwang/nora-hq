import Link from "next/link";
import { cookies } from "next/headers";
import { requireUser } from "@/lib/auth";
import { listLeads } from "@/lib/ops-leads";
import { LEAD_OPPORTUNITIES, type Lead, type LeadOpportunity } from "@/lib/schema";
import { today as todayStr } from "@/lib/dates";
import { FindLeads } from "@/components/lead-find";
import { LeadMenu } from "@/components/lead-menu";
import { LeadCityFilter } from "@/components/lead-city-filter";
import { LeadCard, LeadRow } from "@/components/lead-row";
import { OutreachBoard } from "@/components/outreach-board";
import { ViewToggle } from "@/components/view-toggle";
import { EmptyState, PageHeader, cx } from "@/components/ui";
import { ACTIVE_STAGES, OPP_LABEL, STAGE_LABEL } from "./shared";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const VIEW_COOKIE = "leads_view";

export default async function LeadsPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireUser();
  const sp = await searchParams;
  const viewParam = one(sp.view);
  const remembered = (await cookies()).get(VIEW_COOKIE)?.value;
  const view: "list" | "board" = viewParam === "board" ? "board" : viewParam ? "list" : remembered === "board" ? "board" : "list";
  const opp = (LEAD_OPPORTUNITIES as readonly string[]).includes(one(sp.opp)) ? (one(sp.opp) as LeadOpportunity) : "";
  const error = one(sp.error);

  const all = await listLeads();
  const cityCounts = new Map<string, number>();
  for (const l of all) if (l.city) cityCounts.set(l.city, (cityCounts.get(l.city) ?? 0) + 1);
  const cities = [...cityCounts.keys()].sort((a, b) => a.localeCompare(b));
  const city = cities.includes(one(sp.city)) ? one(sp.city) : "";
  const topCity = [...cityCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";

  const leads = all.filter((l) => (!opp || l.opportunities.includes(opp)) && (!city || l.city === city));
  const byStage = new Map<string, Lead[]>();
  for (const l of leads) byStage.set(l.stage, [...(byStage.get(l.stage) ?? []), l]);
  const won = byStage.get("won") ?? [];
  const lost = [...(byStage.get("lost") ?? []), ...(byStage.get("not_a_fit") ?? [])];
  const activeCount = ACTIVE_STAGES.reduce((n, s) => n + (byStage.get(s)?.length ?? 0), 0);

  const params = { opp, city, view: viewParam ? view : "" };
  const href = (patch: Partial<typeof params>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...params, ...patch })) if (v) u.set(k, v);
    const s = u.toString();
    return s ? `/leads?${s}` : "/leads";
  };
  const back = href({});
  const today = todayStr();
  const now = new Date();
  const exportQs = new URLSearchParams({ ...(opp ? { opp } : {}), ...(city ? { city } : {}) }).toString();

  return (
    <>
      <PageHeader
        title="Leads"
        subtitle="Places that could use us. Claude does the research — you pick who to pitch."
        actions={
          <>
            <LeadMenu exportHref={`/leads/export${exportQs ? `?${exportQs}` : ""}`} />
            <FindLeads defaultArea={city || topCity} autoOpen={one(sp.find) === "1"} />
          </>
        }
      />

      {error && (
        <p role="alert" className="mb-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>
      )}

      {all.length === 0 ? (
        <EmptyState title="No leads yet">
          Tap <strong>Find leads</strong>, say where to look, and Claude researches places with unanswered Google reviews, a quiet Instagram, or a great fit for a collab with Nora.
        </EmptyState>
      ) : (
        <>
          {/* Filters: opportunity chips + city. Plain links — the URL is the source of truth. */}
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <nav aria-label="What for" className="flex flex-wrap gap-1.5">
              <Chip href={href({ opp: "" })} on={!opp}>All</Chip>
              {LEAD_OPPORTUNITIES.map((o) => (
                <Chip key={o} href={href({ opp: o })} on={opp === o}>{OPP_LABEL[o]}</Chip>
              ))}
            </nav>
            {cities.length > 1 && (
              <LeadCityFilter
                cities={cities.map((c) => ({ name: c, count: cityCounts.get(c) ?? 0 }))}
                current={city}
                hrefs={Object.fromEntries([["", href({ city: "" })], ...cities.map((c) => [c, href({ city: c })])])}
              />
            )}
            <div className="ml-auto">
              <ViewToggle
                cookieName={VIEW_COOKIE}
                current={view}
                options={[
                  { value: "list", label: "List", href: href({ view: "list" }) },
                  { value: "board", label: "Board", href: href({ view: "board" }) },
                ]}
              />
            </div>
          </div>

          {leads.length === 0 ? (
            <EmptyState title="No leads match">
              <Link href="/leads" className="text-accent hover:underline">Show all leads</Link>
            </EmptyState>
          ) : view === "board" ? (
            <OutreachBoard
              columns={ACTIVE_STAGES.map((s) => {
                const rows = byStage.get(s) ?? [];
                return {
                  stage: s,
                  label: STAGE_LABEL[s],
                  count: rows.length,
                  content: rows.length ? rows.map((l) => <LeadCard key={l.id} lead={l} today={today} back={back} now={now} />) : <p className="px-1 py-4 text-center text-xs text-muted">Nothing here</p>,
                };
              })}
            />
          ) : activeCount === 0 ? (
            <EmptyState title="Nothing in the pipeline right now">Tap Find leads to get a fresh batch.</EmptyState>
          ) : (
            <div className="space-y-5">
              {ACTIVE_STAGES.map((s) => {
                const rows = byStage.get(s) ?? [];
                if (!rows.length) return null;
                return (
                  <StageGroup key={s} title={STAGE_LABEL[s]} count={rows.length} hint={s === "found" ? "New from Claude — open one, then ask for a pitch or mark it not a fit." : undefined}>
                    {rows.map((l) => <LeadRow key={l.id} lead={l} today={today} back={back} now={now} />)}
                  </StageGroup>
                );
              })}
            </div>
          )}

          {(won.length > 0 || lost.length > 0) && (
            <div className="mt-6 space-y-3">
              {won.length > 0 && (
                <Collapsed title="Won" count={won.length}>
                  {won.map((l) => <LeadRow key={l.id} lead={l} today={today} back={back} now={now} />)}
                </Collapsed>
              )}
              {lost.length > 0 && (
                <Collapsed title="Lost / not a fit" count={lost.length}>
                  {lost.map((l) => <LeadRow key={l.id} lead={l} today={today} back={back} now={now} />)}
                </Collapsed>
              )}
            </div>
          )}

          <p className="mt-6 text-xs text-muted">
            We only use public business contact info. If a place says they’re not interested, set it to Lost and nobody can pitch them again. Emails go out with an opt-out line.
          </p>
        </>
      )}
    </>
  );
}

function Chip({ href, on, children }: { href: string; on: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={on ? "true" : undefined}
      className={cx(
        "inline-flex min-h-11 items-center rounded-full border px-3 text-sm md:min-h-8",
        on ? "border-accent bg-accent-soft font-medium text-accent" : "border-border text-muted hover:text-text",
      )}
    >
      {children}
    </Link>
  );
}

function StageGroup({ title, count, hint, children }: { title: string; count: number; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-surface">
      <header className="flex flex-wrap items-baseline gap-x-2 border-b border-border px-4 py-2.5">
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="text-xs tabular-nums text-muted">{count}</span>
        {hint && <p className="w-full text-xs text-muted sm:ml-auto sm:w-auto">{hint}</p>}
      </header>
      <ul className="divide-y divide-border">{children}</ul>
    </section>
  );
}

function Collapsed({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <details className="group rounded-xl border border-border bg-surface">
      <summary className="no-marker flex min-h-11 cursor-pointer items-center gap-2 px-4 text-sm font-semibold">
        {title}
        <span className="text-xs font-normal tabular-nums text-muted">{count}</span>
        <svg viewBox="0 0 16 16" aria-hidden className="ml-auto size-3.5 transition group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth={1.8}><path d="m4 6 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </summary>
      <ul className="divide-y divide-border border-t border-border">{children}</ul>
    </details>
  );
}
