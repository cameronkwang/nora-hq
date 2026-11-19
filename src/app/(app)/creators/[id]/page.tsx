import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser, seesDrafts } from "@/lib/auth";
import { listClients } from "@/lib/data";
import { OUTREACH_STAGES, type Draft } from "@/lib/schema";
import { formatDate, relativeTime, today } from "@/lib/dates";
import { ActionForm, SubmitButton } from "@/components/client-form";
import { CreatorCopyButton } from "@/components/creator-copy";
import { CreatorFields } from "@/components/creator-fields";
import { ChannelSelect, CompSelect, StageSelect } from "@/components/outreach-fields";
import { Card, EmptyState, PageHeader, PlatformTag, Status, StatusBadge, clientLabel, formatNumber, humanize } from "@/components/ui";
import { shortUrl, statsCheck } from "@/lib/outreach-profile";
import { addOutreachAction, markStatsCheckedAction, saveOutreachAction, setDoNotContactAction, updateCreatorAction } from "../actions";
import { AGREED_STAGES, COMP_LABEL, getCreatorDetail, igDmUrl, igProfileUrl, isFollowUpDue, ttProfileUrl, type OutreachWithClient } from "../queries";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function CreatorPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const viewer = await requireUser();
  const showDrafts = seesDrafts(viewer); // Nora doesn't see DM / email drafts
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const [detail, clients] = await Promise.all([getCreatorDetail(id), listClients()]);
  if (!detail) notFound();
  const { creator: c, outreach, drafts } = detail;
  const now = new Date();
  const flash = one(sp.merged) ? "They were already in the roster, so we updated their existing profile." : one(sp.added) ? "Creator added." : "";
  const available = clients.filter((cl) => !outreach.some((o) => o.clientId === cl.id));
  const draftsFor = (o: OutreachWithClient) => (showDrafts ? drafts.filter((d) => d.meta.outreachId === o.id) : []);
  const check = statsCheck(c, now);

  const facts = [c.city, c.niche, c.source ? `Source: ${c.source}` : null].filter(Boolean).join(" · ");

  return (
    <>
      <PageHeader
        crumb={<Link href="/creators">Creators</Link>}
        title={c.name}
        subtitle={
          c.doNotContact || facts ? (
            <span className="g-meta">
              {c.doNotContact && <Status tone="danger">Do not contact</Status>}
              {facts && <span>{facts}</span>}
            </span>
          ) : undefined
        }
        actions={<a href="#edit" className="link">Edit profile</a>}
      />

      {flash && (
        <p role="status" className="notice mb-2">
          <span className="status is-ok">{flash}</span>
        </p>
      )}

      <div className="cols g-cols mt-0">
        {/* Side (first on a phone): profile facts */}
        <div className="is-side">
          <Card title="Handles" padded={false}>
            <ul className="list">
              {c.instagramHandle ? (
                <li className="py-2.5">
                  <p className="status is-ig is-small text-muted">Instagram</p>
                  <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                    <a href={igProfileUrl(c.instagramHandle)} target="_blank" rel="noopener noreferrer" className="link tap-target break-all">@{c.instagramHandle} ↗</a>
                    {!c.doNotContact && (
                      <a href={igDmUrl(c.instagramHandle)} target="_blank" rel="noopener noreferrer" className="link-quiet tap-target">Open DM ↗</a>
                    )}
                  </div>
                </li>
              ) : null}
              {c.tiktokHandle ? (
                <li className="py-2.5">
                  <p className="status is-tt is-small text-muted">TikTok</p>
                  <a href={ttProfileUrl(c.tiktokHandle)} target="_blank" rel="noopener noreferrer" className="link tap-target break-all">@{c.tiktokHandle} ↗</a>
                  {!c.doNotContact && <p className="meta">DM from their profile in the TikTok app.</p>}
                </li>
              ) : null}
              {c.email ? (
                <li className="py-2.5">
                  <p className="status is-info is-small text-muted">Email</p>
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="break-all">{c.email}</span>
                    <CreatorCopyButton text={c.email} />
                  </div>
                </li>
              ) : null}
              {!c.instagramHandle && !c.tiktokHandle && !c.email && <li className="empty meta">No handles or email yet. Add one below.</li>}
            </ul>
          </Card>

          <Card title="Stats">
            {/* Label and number on hairlines: three figures side by side don't fit the 300px side column. */}
            <dl className="g-kv is-ruled">
              <div><dt>IG followers</dt><dd className="num font-medium">{formatNumber(c.instagramFollowers)}</dd></div>
              <div><dt>TikTok followers</dt><dd className="num font-medium">{formatNumber(c.tiktokFollowers)}</dd></div>
              <div><dt>Engagement</dt><dd className="num font-medium">{c.engagementRate != null ? `${c.engagementRate.toFixed(1)}%` : "—"}</dd></div>
            </dl>
            <p className="meta mt-3">
              {c.statsUpdatedAt ? `Updated ${formatDate(c.statsUpdatedAt)} (${relativeTime(c.statsUpdatedAt, now)})` : "Not recorded yet."} Follower counts change, so refresh them before pitching.
            </p>
            {/* Creator check: when the numbers were last read from their public page. Outreach drafts warn when it's never or over 30 days. */}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-border pt-3">
              <p className="min-w-0 break-words">
                <Status tone={check.state === "fresh" ? "ok" : "warn"} small className="whitespace-normal">
                  {check.state === "never" ? "Never checked against their page" : `${check.label.replace(/^c/, "C")}${check.state === "stale" ? " (over 30 days)" : ""}`}
                </Status>
                {c.statsSource && check.state !== "never" && (
                  <>
                    <span className="meta"> · </span>
                    <a href={c.statsSource} target="_blank" rel="noopener noreferrer nofollow" className="link text-sm">{shortUrl(c.statsSource)} ↗</a>
                  </>
                )}
              </p>
              <form action={markStatsCheckedAction.bind(null, c.id)}>
                <SubmitButton variant="secondary" size="sm" pendingLabel="Saving…">Checked today</SubmitButton>
              </form>
            </div>
          </Card>

          <Card title="Notes">
            {c.notes ? <p className="whitespace-pre-wrap">{c.notes}</p> : <p className="meta">No notes yet.</p>}
          </Card>

          <Card title="Do not contact">
            <p className="meta">
              {c.doNotContact
                ? "They asked not to be contacted (or we decided not to). Outreach can't be moved to contacted, and Claude won't draft emails to them."
                : "Turn this on if they ask us to stop, or say no and don't want follow-ups. Always honor opt-outs."}
            </p>
            <form action={setDoNotContactAction.bind(null, c.id)} className="mt-3">
              <input type="hidden" name="doNotContact" value={c.doNotContact ? "0" : "1"} />
              <SubmitButton variant={c.doNotContact ? "secondary" : "danger"} size="sm" pendingLabel="Saving…">
                {c.doNotContact ? "Allow contact again" : "Mark do not contact"}
              </SubmitButton>
            </form>
          </Card>
        </div>

        {/* Main: outreach per business */}
        <div className="is-main">
          <h2 className="eyebrow mb-3">Outreach</h2>
          <div className="[&>.sec:first-child]:mt-0">
            {outreach.length === 0 ? (
              <EmptyState title="Not in outreach with any business yet">Add them to a business below to start a pipeline.</EmptyState>
            ) : (
              outreach.map((o) => <OutreachCard key={o.id} o={o} creatorId={c.id} drafts={draftsFor(o)} showDrafts={showDrafts} now={now} />)
            )}

            <Card title="Add to another business">
              {available.length === 0 ? (
                <p className="meta">Already in outreach with every business.</p>
              ) : (
                <ActionForm action={addOutreachAction.bind(null, c.id)} ariaLabel="Add to another business" className="grid gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label className="label" htmlFor="add-client">Business</label>
                    <select id="add-client" name="clientId" className="input" required defaultValue="">
                      <option value="" disabled>Pick a business</option>
                      {available.map((cl) => (
                        <option key={cl.id} value={cl.id}>{clientLabel(cl)}</option>
                      ))}
                    </select>
                  </div>
                  <ChannelSelect idPrefix="add" defaultValue={c.instagramHandle ? "instagram_dm" : c.tiktokHandle ? "tiktok_dm" : "email"} />
                  <CompSelect idPrefix="add" />
                  <StageSelect idPrefix="add" stages={["sourced", "shortlisted"]} />
                  <div className="sm:col-span-2">
                    <label className="label" htmlFor="add-prior">Already posted about this business? (link, optional)</label>
                    <input id="add-prior" name="priorPostUrl" type="url" inputMode="url" className="input" placeholder="https://www.tiktok.com/@creator/video/…" autoCapitalize="none" autoComplete="off" />
                  </div>
                  <div>
                    <SubmitButton variant="secondary" pendingLabel="Adding…">Add</SubmitButton>
                  </div>
                </ActionForm>
              )}
            </Card>
          </div>
        </div>
      </div>

      {/* Under the two columns, in the main column's track (.cols with one child), so its rule ends where theirs does. */}
      <div id="edit" className="cols scroll-mt-6">
        <div>
          <Card title="Edit profile">
            <ActionForm action={updateCreatorAction.bind(null, c.id)} ariaLabel="Edit creator profile" className="space-y-4">
              <CreatorFields creator={c} />
              <p className="hint">Clearing a field removes it. Changing follower counts or engagement updates the “stats updated” date.</p>
              <SubmitButton>Save profile</SubmitButton>
            </ActionForm>
          </Card>
        </div>
      </div>
    </>
  );
}

function OutreachCard({ o, creatorId, drafts, showDrafts, now }: { o: OutreachWithClient; creatorId: string; drafts: Draft[]; showDrafts: boolean; now: Date }) {
  const due = isFollowUpDue(o, now);
  const showFtc = AGREED_STAGES.includes(o.stage);
  const idp = `o-${o.id}`;
  return (
    <Card
      className="g-wraphead"
      title={
        <Link href={`/clients/${o.clientId}`} className="no-underline hover:underline">{clientLabel(o.client)}</Link>
      }
      actions={
        <div className="flex flex-wrap items-baseline justify-end gap-x-4 gap-y-1">
          {due && <Status tone="warn" small>Follow up due</Status>}
          {o.priorPostUrl && <Status tone="danger" small>Already featured</Status>}
          <StatusBadge status={o.stage} />
        </div>
      }
    >
      <dl className="mb-5 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        <div><dt className="meta">Channel</dt><dd><PlatformTag platform={o.channel} inherit /></dd></div>
        <div><dt className="meta">Comp</dt><dd>{COMP_LABEL[o.compType] ?? humanize(o.compType)}</dd></div>
        <div><dt className="meta">First contacted</dt><dd>{o.contactedAt ? formatDate(o.contactedAt) : "Not yet"}</dd></div>
        <div><dt className="meta">Last activity</dt><dd>{o.lastActivityAt ? relativeTime(o.lastActivityAt, now) : "—"}</dd></div>
      </dl>

      {showFtc && (
        <div role="note" className="notice mb-5 block">
          <p className="status is-warn font-medium">Disclosure reminder</p>
          <p className="meta mt-1">
            The FTC requires creators to clearly disclose gifted meals and paid posts (e.g. “gifted”, #ad, or the platform's paid-partnership label).
            Never ask for Google or Yelp reviews in exchange for comps.
          </p>
        </div>
      )}

      <ActionForm action={saveOutreachAction.bind(null, o.clientId, creatorId)} ariaLabel={`Outreach with ${o.client.name}`} className="grid gap-4 sm:grid-cols-2">
        <input type="hidden" name="currentStage" value={o.stage} />
        <StageSelect idPrefix={idp} defaultValue={o.stage} stages={OUTREACH_STAGES} />
        <ChannelSelect idPrefix={idp} defaultValue={o.channel} />
        <CompSelect idPrefix={idp} defaultValue={o.compType} />
        <div>
          <label className="label" htmlFor={`${idp}-fu`}>Next follow-up</label>
          <input id={`${idp}-fu`} name="nextFollowUpAt" type="date" className="input" defaultValue={o.nextFollowUpAt ? today(o.nextFollowUpAt) : ""} />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor={`${idp}-url`}>Post link</label>
          <input id={`${idp}-url`} name="postUrl" type="url" className="input" defaultValue={o.postUrl ?? ""} placeholder="https://www.instagram.com/p/…" />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor={`${idp}-prior`}>Earlier post about {o.client.name} (before we reached out)</label>
          <input id={`${idp}-prior`} name="priorPostUrl" type="url" inputMode="url" className="input" defaultValue={o.priorPostUrl ?? ""} placeholder="https://www.tiktok.com/@creator/video/…" autoCapitalize="none" autoComplete="off" />
          <p className="hint">
            {o.priorPostUrl && o.priorPostFoundAt ? `Found ${formatDate(o.priorPostFoundAt)}. ` : ""}
            If they already posted about this business, paste that post here. They&apos;re marked already featured and Claude won&apos;t pitch them for it again.
          </p>
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor={`${idp}-disc`}>Their post clearly says gifted/#ad</label>
          <select id={`${idp}-disc`} name="disclosureOk" className="input" defaultValue={o.disclosureOk === true ? "yes" : o.disclosureOk === false ? "no" : ""}>
            <option value="">Not checked yet</option>
            <option value="yes">Yes, clearly disclosed</option>
            <option value="no">No, ask them to add it</option>
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor={`${idp}-notes`}>Notes</label>
          <textarea id={`${idp}-notes`} name="notes" className="input" defaultValue={o.notes ?? ""} placeholder="What they said, visit date, what they ordered…" />
        </div>
        <div className="sm:col-span-2">
          <SubmitButton>Save</SubmitButton>
        </div>
      </ActionForm>

      {showDrafts && (
      <div className="mt-6">
        <h3 className="eyebrow border-b border-border pb-2">Drafts</h3>
        {drafts.length === 0 ? (
          <p className="meta py-3">No drafts yet. Ask Claude to draft a {o.channel === "email" ? "pitch email" : "DM"} for {o.client.name}.</p>
        ) : (
          <ul className="list">
            {drafts.map((d) => (
              <li key={d.id} className="g-row">
                <span className="row-title truncate">{d.title}</span>
                <span className="end">
                  <StatusBadge status={d.status} />
                  {(d.status === "needs_review" || d.status === "approved" || d.status === "failed") && (
                    <Link href={`/review#${d.id}`} className="link text-sm">
                      {d.status === "needs_review" ? "Review" : d.status === "approved" ? "Send" : "Fix"} →
                    </Link>
                  )}
                </span>
                <p className="more">
                  {d.kind === "outreach_email" ? "Email" : "DM"} · {d.sentAt ? `sent ${formatDate(d.sentAt)}` : `created ${relativeTime(d.createdAt, new Date())}`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
      )}
    </Card>
  );
}
