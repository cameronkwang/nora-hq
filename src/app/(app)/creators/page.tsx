import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listClients } from "@/lib/data";
import { OUTREACH_STAGES } from "@/lib/schema";
import { currentMonth, monthLabel } from "@/lib/dates";
import { OutreachPipeline } from "@/components/outreach-pipeline";
import { Badge, Card, EmptyState, LinkButton, PageHeader, Stat, StatusBadge, buttonClass, clientLabel, cx, formatNumber, humanize } from "@/components/ui";
import { moveStageAction } from "./actions";
import {
  AGREED_STAGES,
  CHANNEL_LABEL,
  REPLIED_STAGES,
  igProfileUrl,
  isFollowUpDue,
  listCreatorRows,
  monthBounds,
  ttProfileUrl,
  type CreatorRow,
  type OutreachWithClient,
} from "./queries";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function CreatorsPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireUser();
  const sp = await searchParams;
  const view = one(sp.view) === "pipeline" ? "pipeline" : "list";
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

  const params = { q, client, stage, channel, due: due ? "1" : "", dnc: showDnc ? "1" : "", view };
  const href = (patch: Partial<typeof params>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...params, ...patch })) if (v && !(k === "view" && v === "list")) u.set(k, v);
    const s = u.toString();
    return s ? `/creators?${s}` : "/creators";
  };
  const selfHref = href({});
  const clientName = new Map(clients.map((c) => [c.id, clientLabel(c)]));
  const filtersOn = !!(q || stage || channel || due || showDnc || (view === "list" && client));

  return (
    <>
      <PageHeader
        title="Creators"
        subtitle="Local creators and where each one stands with every business. DMs get sent by hand after approval; emails send from Gmail on approval."
        actions={
          <>
            <a href={`/creators/export${client ? `?client=${encodeURIComponent(client)}` : ""}`} className={buttonClass("secondary")} download>
              Export CSV
            </a>
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
        <Link href={href({ due: "1", view: "list" })} className="col-span-2 block rounded-xl sm:col-span-1">
          <Stat label="Follow-ups due" value={<span className={stats.due ? "text-warn" : undefined}>{formatNumber(stats.due)}</span>} hint={stats.due ? "Tap to see them" : "All caught up"} />
        </Link>
      </div>

      {/* View switch */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <nav aria-label="View" className="inline-flex rounded-lg border border-border bg-surface p-0.5 text-sm">
          {(["list", "pipeline"] as const).map((v) => (
            <Link
              key={v}
              href={href({ view: v })}
              aria-current={view === v ? "page" : undefined}
              className={cx("rounded-md px-3 py-1.5 font-medium", view === v ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface-2")}
            >
              {v === "list" ? "List" : "Pipeline"}
            </Link>
          ))}
        </nav>
        {filtersOn && (
          <Link href={view === "pipeline" ? href({ q: "", stage: "", channel: "", due: "", dnc: "" }) : "/creators"} className="text-sm text-accent hover:underline">
            Clear filters
          </Link>
        )}
      </div>

      {/* Filters: a plain GET form, works without JS */}
      <form method="get" action="/creators" className="mb-5 grid gap-3 rounded-xl border border-border bg-surface p-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_auto]" role="search">
        {view === "pipeline" && <input type="hidden" name="view" value="pipeline" />}
        <div>
          <label className="label" htmlFor="f-q">Search</label>
          <input id="f-q" name="q" type="search" defaultValue={q} placeholder="Name, @handle or city" className="input" />
        </div>
        <div>
          <label className="label" htmlFor="f-client">Business</label>
          <select id="f-client" name="client" defaultValue={client} className="input">
            {view === "list" && <option value="">All businesses</option>}
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{clientLabel(c)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="f-stage">Stage</label>
          <select id="f-stage" name="stage" defaultValue={stage} className="input" disabled={view === "pipeline"}>
            <option value="">{view === "pipeline" ? "Shown as columns" : "Any stage"}</option>
            {OUTREACH_STAGES.map((s) => (
              <option key={s} value={s}>{humanize(s)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="f-channel">Channel</label>
          <select id="f-channel" name="channel" defaultValue={channel} className="input">
            <option value="">Any channel</option>
            {Object.entries(CHANNEL_LABEL).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap items-end gap-x-4 gap-y-2 sm:col-span-2 lg:col-span-1">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="due" value="1" defaultChecked={due} className="size-4 accent-[var(--accent)]" />
            Follow-up due
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="dnc" value="1" defaultChecked={showDnc} className="size-4 accent-[var(--accent)]" />
            Show do-not-contact
          </label>
          <button type="submit" className={buttonClass("secondary", "sm")}>Apply</button>
        </div>
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
          Add one by hand, or drop an ask for Claude to research local food creators for a business.
          <div className="mt-3">
            <LinkButton href="/creators/new" variant="primary" size="sm">Add creator</LinkButton>
          </div>
        </EmptyState>
      ) : listRows.length === 0 ? (
        <EmptyState title="No creators match these filters">
          <Link href="/creators" className="text-accent hover:underline">Clear filters</Link>
          {!showDnc && hiddenDnc > 0 && <> · do-not-contact creators are hidden</>}
        </EmptyState>
      ) : (
        <Card padded={false} title={`${listRows.length} creator${listRows.length === 1 ? "" : "s"}`}>
          <CreatorTable rows={listRows} highlight={(o) => !hasOutreachFilter || outreachMatch(o)} now={now} />
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

function CreatorTable({ rows, highlight, now }: { rows: CreatorRow[]; highlight: (o: OutreachWithClient) => boolean; now: Date }) {
  return (
    <ul className="divide-y divide-border">
      <li aria-hidden className="hidden gap-4 px-4 py-2 text-xs font-medium text-muted lg:grid lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,1.6fr)]">
        <span>Creator</span>
        <span>Handles</span>
        <span>Followers · engagement</span>
        <span>Outreach</span>
      </li>
      {rows.map((c) => (
        <li key={c.id} className="grid gap-2 px-4 py-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,1.6fr)] lg:items-start lg:gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/creators/${c.id}`} className="font-medium hover:underline">{c.name}</Link>
              {c.doNotContact && <Badge tone="danger">Do not contact</Badge>}
            </div>
            {(c.city || c.niche) && <p className="mt-0.5 text-xs text-muted">{[c.city, c.niche].filter(Boolean).join(" · ")}</p>}
          </div>

          <div className="flex min-w-0 flex-wrap gap-x-3 gap-y-0.5 text-xs lg:flex-col">
            {c.instagramHandle && (
              <a href={igProfileUrl(c.instagramHandle)} target="_blank" rel="noopener noreferrer" className="truncate text-ig hover:underline">
                IG @{c.instagramHandle}
              </a>
            )}
            {c.tiktokHandle && (
              <a href={ttProfileUrl(c.tiktokHandle)} target="_blank" rel="noopener noreferrer" className="truncate text-tt hover:underline">
                TikTok @{c.tiktokHandle}
              </a>
            )}
            {c.email && <span className="truncate text-muted">{c.email}</span>}
            {!c.instagramHandle && !c.tiktokHandle && !c.email && <span className="text-muted">No handles yet</span>}
          </div>

          <div className="flex flex-wrap gap-x-3 text-xs tabular-nums lg:flex-col">
            {c.instagramFollowers != null && <span><span className="text-muted">IG</span> {formatNumber(c.instagramFollowers)}</span>}
            {c.tiktokFollowers != null && <span><span className="text-muted">TT</span> {formatNumber(c.tiktokFollowers)}</span>}
            {c.engagementRate != null && <span><span className="text-muted">Eng.</span> {c.engagementRate.toFixed(1)}%</span>}
            {c.instagramFollowers == null && c.tiktokFollowers == null && c.engagementRate == null && <span className="text-muted">No stats yet</span>}
          </div>

          <div className="min-w-0">
            {c.outreach.length === 0 ? (
              <span className="text-xs text-muted">Not in outreach yet</span>
            ) : (
              <ul className="flex flex-col gap-1">
                {c.outreach.map((o) => (
                  <li key={o.id} className={cx("flex flex-wrap items-center gap-x-2 gap-y-1 text-xs", !highlight(o) && "opacity-50")}>
                    <span className="min-w-0 truncate">{clientLabel(o.client)}</span>
                    <StatusBadge status={o.stage} />
                    {isFollowUpDue(o, now) && <Badge tone="warn">Follow up</Badge>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
