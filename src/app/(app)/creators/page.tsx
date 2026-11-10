import Link from "next/link";
import { cookies } from "next/headers";
import { requireUser } from "@/lib/auth";
import { listClients } from "@/lib/data";
import { OUTREACH_STAGES } from "@/lib/schema";
import { currentMonth, formatDate, monthLabel } from "@/lib/dates";
import { OutreachPipeline } from "@/components/outreach-pipeline";
import { CreatorMenu } from "@/components/creator-menu";
import { CreatorTable, type CreatorTableRow } from "@/components/creator-table";
import { ViewToggle } from "@/components/view-toggle";
import { Card, EmptyState, LinkButton, PageHeader, Stat, buttonClass, clientLabel, formatNumber, humanize } from "@/components/ui";
import { moveStageAction } from "./actions";
import {
  AGREED_STAGES,
  CHANNEL_LABEL,
  CLOSED_STAGES,
  REPLIED_STAGES,
  isFollowUpDue,
  listCreatorRows,
  monthBounds,
  type CreatorRow,
  type OutreachWithClient,
} from "./queries";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const VIEW_COOKIE = "creators_view";

export default async function CreatorsPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireUser();
  const sp = await searchParams;
  // ?view= wins; otherwise open the way you last left it (ViewToggle remembers it in a cookie).
  const viewParam = one(sp.view);
  const remembered = (await cookies()).get(VIEW_COOKIE)?.value;
  const view: "table" | "pipeline" = viewParam === "pipeline" ? "pipeline" : viewParam ? "table" : remembered === "board" ? "pipeline" : "table";
  const q = one(sp.q).trim();
  const stage = (OUTREACH_STAGES as readonly string[]).includes(one(sp.stage)) ? one(sp.stage) : "";
  const channel = Object.keys(CHANNEL_LABEL).includes(one(sp.channel)) ? one(sp.channel) : "";
  const due = one(sp.due) === "1";
  const showDnc = one(sp.dnc) === "1";
  const error = one(sp.error);

  const [clients, all] = await Promise.all([listClients(), listCreatorRows()]);
  const clientIds = new Set(clients.map((c) => c.id));
  let client = clientIds.has(one(sp.client)) ? one(sp.client) : "";
  if (view === "pipeline" && !client) client = clients[0]?.id ?? "";

  const now = new Date();
  const month = currentMonth();
  const { start, next } = monthBounds(month);

  // Filters
  const needle = q.toLowerCase().replace(/^@/, "");
  const textMatch = (c: CreatorRow) =>
    !needle ||
    [c.name, c.instagramHandle, c.tiktokHandle, c.city, c.niche, c.email].some((f) => f?.toLowerCase().includes(needle));
  const outreachMatch = (o: OutreachWithClient, opts: { ignoreStage?: boolean } = {}) =>
    (!client || o.clientId === client) &&
    (opts.ignoreStage || !stage || o.stage === stage) &&
    (!channel || o.channel === channel) &&
    (!due || isFollowUpDue(o, now));
  const hasOutreachFilter = !!(client || stage || channel || due);
  const visible = all.filter((c) => (showDnc || !c.doNotContact) && textMatch(c));
  const listRows = visible.filter((c) => !hasOutreachFilter || c.outreach.some((o) => outreachMatch(o)));
  const hiddenDnc = all.filter((c) => c.doNotContact).length;

  // Stats (scoped to the selected business, if any)
  const scopedOutreach = all.flatMap((c) => c.outreach.filter((o) => !client || o.clientId === client));
  const stats = {
    creators: client ? new Set(scopedOutreach.map((o) => o.creatorId)).size : all.filter((c) => !c.doNotContact).length,
    contacted: scopedOutreach.filter((o) => o.contactedAt && o.contactedAt >= start && o.contactedAt < next).length,
    replies: scopedOutreach.filter((o) => REPLIED_STAGES.includes(o.stage)).length,
    agreed: scopedOutreach.filter((o) => AGREED_STAGES.includes(o.stage)).length,
    due: scopedOutreach.filter((o) => isFollowUpDue(o, now)).length,
  };

  const params = { q, client, stage, channel, due: due ? "1" : "", dnc: showDnc ? "1" : "", view: viewParam ? view : "" };
  const href = (patch: Partial<typeof params>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...params, ...patch })) if (v) u.set(k, v);
    const s = u.toString();
    return s ? `/creators?${s}` : "/creators";
  };
  const selfHref = href({ view });
  const clientName = new Map(clients.map((c) => [c.id, clientLabel(c)]));
  // Short business names on chips; add the location only where two businesses share a name.
  const nameCount = new Map<string, number>();
  for (const c of clients) nameCount.set(c.name, (nameCount.get(c.name) ?? 0) + 1);
  const chipName = (c: OutreachWithClient["client"]) => ((nameCount.get(c.name) ?? 0) > 1 ? clientLabel(c) : c.name);
  const moreFiltersOn = !!(stage || channel || due);
  const filtersOn = !!(q || moreFiltersOn || (view === "table" && client));

  const tableRows: CreatorTableRow[] = listRows.map((c) => {
    const open = c.outreach
      .filter((o) => o.nextFollowUpAt && !(CLOSED_STAGES as readonly string[]).includes(o.stage) && o.stage !== "posted")
      .sort((a, b) => a.nextFollowUpAt!.getTime() - b.nextFollowUpAt!.getTime());
    const nf = open[0];
    return {
      id: c.id,
      name: c.name,
      instagramHandle: c.instagramHandle,
      tiktokHandle: c.tiktokHandle,
      email: c.email,
      city: c.city,
      niche: c.niche,
      instagramFollowers: c.instagramFollowers,
      tiktokFollowers: c.tiktokFollowers,
      engagementRate: c.engagementRate,
      doNotContact: c.doNotContact,
      outreach: c.outreach.map((o) => ({ id: o.id, client: chipName(o.client), stage: o.stage, due: isFollowUpDue(o, now), dim: hasOutreachFilter && !outreachMatch(o) })),
      nextFollowUp: nf?.nextFollowUpAt ? { at: nf.nextFollowUpAt.toISOString(), label: formatDate(nf.nextFollowUpAt), due: isFollowUpDue(nf, now) } : null,
    };
  });

  return (
    <>
      <PageHeader
        title="Creators"
        subtitle="Local creators and where each one stands with every business."
        actions={
          <>
            <CreatorMenu exportHref={`/creators/export${client ? `?client=${encodeURIComponent(client)}` : ""}`} />
            <LinkButton href={client ? `/creators/new?client=${encodeURIComponent(client)}` : "/creators/new"} variant="primary">
              Add creator
            </LinkButton>
          </>
        }
      />

      {error && (
        <p role="alert" className="mb-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label={client ? "Creators in outreach" : "Creators"} value={formatNumber(stats.creators)} hint={client ? clientName.get(client) : hiddenDnc ? `${hiddenDnc} do-not-contact not counted` : undefined} />
        <Stat label="Contacted this month" value={formatNumber(stats.contacted)} hint={monthLabel(month)} />
        <Stat label="Replies" value={formatNumber(stats.replies)} hint="Replied or further, incl. declines" />
        <Stat label="Agreed / posted" value={formatNumber(stats.agreed)} />
        <Link href={href({ due: "1", view: "table" })} className="col-span-2 block rounded-xl sm:col-span-1">
          <Stat label="Follow-ups due" value={<span className={stats.due ? "text-warn" : undefined}>{formatNumber(stats.due)}</span>} hint={stats.due ? "Tap to see them" : "All caught up"} />
        </Link>
      </div>

      {/* View switch */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <ViewToggle
          cookieName={VIEW_COOKIE}
          current={view === "pipeline" ? "board" : "table"}
          options={[
            { value: "table", label: "Table", href: href({ view: "table" }) },
            { value: "board", label: "Pipeline", href: href({ view: "pipeline", stage: "" }) },
          ]}
        />
        {filtersOn && (
          <Link href={href({ q: "", stage: "", channel: "", due: "", client: view === "pipeline" ? client : "", view })} className="inline-flex min-h-11 items-center text-sm text-accent hover:underline md:min-h-0">
            Clear filters
          </Link>
        )}
      </div>

      {/* Filters: a plain GET form, works without JS. The rarely used ones sit behind "More filters". */}
      <form method="get" action="/creators" className="mb-5 rounded-xl border border-border bg-surface p-3" role="search">
        <input type="hidden" name="view" value={view} />
        {showDnc && <input type="hidden" name="dnc" value="1" />}
        <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]">
          <div>
            <label className="label" htmlFor="f-q">Search</label>
            <input id="f-q" name="q" type="search" defaultValue={q} placeholder="Name, @handle or city" className="input" />
          </div>
          <div>
            <label className="label" htmlFor="f-client">Business</label>
            <select id="f-client" name="client" defaultValue={client} className="input">
              {view === "table" && <option value="">All businesses</option>}
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{clientLabel(c)}</option>
              ))}
            </select>
          </div>
          <button type="submit" className={buttonClass("secondary")}>Apply</button>
        </div>
        <details className="group mt-2" open={moreFiltersOn || undefined}>
          <summary className="no-marker inline-flex min-h-11 cursor-pointer items-center gap-1 text-sm text-muted hover:text-text md:min-h-8">
            More filters
            <svg viewBox="0 0 16 16" aria-hidden className="size-3.5 transition group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth={1.8}>
              <path d="m4 6 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </summary>
          <div className="grid items-end gap-3 pt-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            {view === "table" && (
              <div>
                <label className="label" htmlFor="f-stage">Stage</label>
                <select id="f-stage" name="stage" defaultValue={stage} className="input">
                  <option value="">Any stage</option>
                  {OUTREACH_STAGES.map((s) => (
                    <option key={s} value={s}>{humanize(s)}</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="label" htmlFor="f-channel">Channel</label>
              <select id="f-channel" name="channel" defaultValue={channel} className="input">
                <option value="">Any channel</option>
                {Object.entries(CHANNEL_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" name="due" value="1" defaultChecked={due} />
              Follow-up due
            </label>
          </div>
        </details>
      </form>

      {view === "pipeline" ? (
        <PipelineView
          clientId={client}
          clientName={clientName.get(client) ?? ""}
          rows={visible.flatMap((c) => c.outreach.filter((o) => outreachMatch(o, { ignoreStage: true })).map((o) => ({ ...o, creator: c })))}
          back={selfHref}
          now={now}
          noClients={clients.length === 0}
        />
      ) : all.length === 0 ? (
        <EmptyState title="No creators yet">
          Add one by hand, import a list from Google Sheets, or ask Claude to research local food creators for a business.
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            <LinkButton href="/creators/new" variant="primary" size="sm">Add creator</LinkButton>
            <LinkButton href="/creators/import" size="sm">Import a list</LinkButton>
          </div>
        </EmptyState>
      ) : listRows.length === 0 ? (
        <EmptyState title="No creators match these filters">
          <Link href={href({ q: "", stage: "", channel: "", due: "", client: "", view: "table" })} className="text-accent hover:underline">Clear filters</Link>
          {!showDnc && hiddenDnc > 0 && <> · do-not-contact creators are hidden</>}
        </EmptyState>
      ) : (
        <Card
          padded={false}
          title={`${listRows.length} creator${listRows.length === 1 ? "" : "s"}`}
          actions={
            (hiddenDnc > 0 || showDnc) && (
              <Link href={href({ dnc: showDnc ? "" : "1", view: "table" })} className="inline-flex min-h-11 items-center text-xs text-muted hover:text-text hover:underline md:min-h-0">
                {showDnc ? "Hide do-not-contact" : `Show do-not-contact (${hiddenDnc})`}
              </Link>
            )
          }
        >
          <CreatorTable rows={tableRows} />
        </Card>
      )}
    </>
  );
}

function PipelineView({
  clientId,
  clientName,
  rows,
  back,
  now,
  noClients,
}: {
  clientId: string;
  clientName: string;
  rows: Parameters<typeof OutreachPipeline>[0]["rows"];
  back: string;
  now: Date;
  noClients: boolean;
}) {
  if (noClients || !clientId) {
    return <EmptyState title="No businesses yet">Add a business first, then build its creator pipeline.</EmptyState>;
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{clientName}</h2>
        <LinkButton href={`/creators/new?client=${encodeURIComponent(clientId)}`} size="sm">Add creator to this business</LinkButton>
      </div>
      {rows.length === 0 ? (
        <EmptyState title={`No creators in outreach for ${clientName} yet`}>
          Add a creator, or open an existing creator and use “Add to another business”.
        </EmptyState>
      ) : (
        <OutreachPipeline rows={rows} back={back} moveAction={moveStageAction} now={now} />
      )}
    </div>
  );
}
