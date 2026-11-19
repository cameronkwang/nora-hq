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
import { Card, EmptyState, PageHeader } from "@/components/ui";
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
        subtitle="Places that could use us. Claude does the research, you pick who to pitch."
        actions={
          <>
            {/* The view switch sits in the head, as on /tasks (only once there are leads to show two ways). */}
            {all.length > 0 && (
              <ViewToggle
                cookieName={VIEW_COOKIE}
                current={view}
                options={[
                  { value: "list", label: "List", href: href({ view: "list" }) },
                  { value: "board", label: "Board", href: href({ view: "board" }) },
                ]}
              />
            )}
            <LeadMenu exportHref={`/leads/export${exportQs ? `?${exportQs}` : ""}`} />
            <FindLeads defaultArea={city || topCity} autoOpen={one(sp.find) === "1"} />
          </>
        }
      />

      {error && (
        <p role="alert" className="notice mb-6"><span className="status is-danger">{error}</span></p>
      )}

      {all.length === 0 ? (
        <EmptyState title="No leads yet">
          Tap <strong>Find leads</strong>, say where to look, and Claude researches places with unanswered Google reviews, a quiet Instagram, or a great fit for a collab with Nora.
        </EmptyState>
      ) : (
        <>
          {/* Filters: opportunity chips + city. Plain links: the URL is the source of truth. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <nav aria-label="What for" className="chips">
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
          </div>

          {leads.length === 0 ? (
            <EmptyState title="No leads match">
              <Link href="/leads" className="link">Show all leads</Link>
            </EmptyState>
          ) : view === "board" ? (
            <div className="mt-8">
              <OutreachBoard
                columns={ACTIVE_STAGES.map((s) => {
                  const rows = byStage.get(s) ?? [];
                  return {
                    stage: s,
                    label: STAGE_LABEL[s],
                    count: rows.length,
                    content: rows.length ? (
                      <ul key={s} className="list">{rows.map((l) => <LeadCard key={l.id} lead={l} today={today} back={back} now={now} />)}</ul>
                    ) : (
                      <p key={s} className="g-col-empty">Nothing here</p>
                    ),
                  };
                })}
              />
            </div>
          ) : activeCount === 0 ? (
            <EmptyState title="Nothing in the pipeline right now">Tap Find leads to get a fresh batch.</EmptyState>
          ) : (
            ACTIVE_STAGES.map((s) => {
              const rows = byStage.get(s) ?? [];
              if (!rows.length) return null;
              return (
                <StageGroup key={s} title={STAGE_LABEL[s]} count={rows.length} hint={s === "found" ? "New from Claude. Open one, then ask for a pitch or mark it not a fit." : undefined}>
                  {rows.map((l) => <LeadRow key={l.id} lead={l} today={today} back={back} now={now} />)}
                </StageGroup>
              );
            })
          )}

          {(won.length > 0 || lost.length > 0) && (
            <>
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
            </>
          )}

          <p className="meta mt-10 max-w-2xl">
            We only use public business contact info. If a place says they’re not interested, set it to Lost and nobody can pitch them again. Emails go out with an opt-out line.
          </p>
        </>
      )}
    </>
  );
}

function Chip({ href, on, children }: { href: string; on: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} aria-current={on ? "true" : undefined} className="chip">
      <span>{children}</span>
    </Link>
  );
}

function StageGroup({ title, count, hint, children }: { title: string; count: number; hint?: string; children: React.ReactNode }) {
  return (
    <Card title={<>{title}<span className="meta num">{count}</span></>} padded={false}>
      {hint && <p className="sec-note">{hint}</p>}
      <ul className="list">{children}</ul>
    </Card>
  );
}

function Collapsed({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <details className="sec g-fold">
      <summary className="sec-head">
        <span className="title">{title}<span className="meta num">{count}</span></span>
        <svg viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M6 3.5 10.5 8 6 12.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </summary>
      <ul className="list">{children}</ul>
    </details>
  );
}
