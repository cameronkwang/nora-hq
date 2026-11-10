import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { listClients } from "@/lib/data";
import { OUTREACH_STAGES, type Draft } from "@/lib/schema";
import { formatDate, relativeTime, today } from "@/lib/dates";
import { ActionForm, SubmitButton } from "@/components/client-form";
import { CreatorCopyButton } from "@/components/creator-copy";
import { CreatorFields } from "@/components/creator-fields";
import { ChannelSelect, CompSelect, StageSelect } from "@/components/outreach-fields";
import { Badge, Card, EmptyState, PageHeader, PlatformTag, StatusBadge, clientLabel, formatNumber, humanize } from "@/components/ui";
import { addOutreachAction, saveOutreachAction, setDoNotContactAction, updateCreatorAction } from "../actions";
import { AGREED_STAGES, COMP_LABEL, getCreatorDetail, igDmUrl, igProfileUrl, isFollowUpDue, ttProfileUrl, type OutreachWithClient } from "../queries";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function CreatorPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  await requireUser();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const [detail, clients] = await Promise.all([getCreatorDetail(id), listClients()]);
  if (!detail) notFound();
  const { creator: c, outreach, drafts } = detail;
  const now = new Date();
  const flash = one(sp.merged) ? "They were already in the roster, so we updated their existing profile." : one(sp.added) ? "Creator added." : "";
  const available = clients.filter((cl) => !outreach.some((o) => o.clientId === cl.id));
  const draftsFor = (o: OutreachWithClient) => drafts.filter((d) => d.meta.outreachId === o.id);

  return (
    <>
      <p className="mb-2 text-sm">
        <Link href="/creators" className="text-muted hover:underline">← Creators</Link>
      </p>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {c.name}
            {c.doNotContact && <Badge tone="danger">Do not contact</Badge>}
          </span>
        }
        subtitle={[c.city, c.niche, c.source ? `Source: ${c.source}` : null].filter(Boolean).join(" · ") || undefined}
        actions={<a href="#edit" className="text-sm text-accent hover:underline">Edit profile</a>}
      />

      {flash && (
        <p role="status" className="mb-4 rounded-lg bg-ok-soft px-3 py-2 text-sm text-ok">{flash}</p>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        {/* Left: profile facts */}
        <div className="space-y-5">
          <Card title="Handles">
            <ul className="space-y-3 text-sm">
              {c.instagramHandle ? (
                <li>
                  <p className="text-xs font-medium text-ig">Instagram</p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <a href={igProfileUrl(c.instagramHandle)} target="_blank" rel="noopener noreferrer" className="break-all hover:underline">@{c.instagramHandle} ↗</a>
                    {!c.doNotContact && (
                      <a href={igDmUrl(c.instagramHandle)} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">Open DM ↗</a>
                    )}
                  </div>
                </li>
              ) : null}
              {c.tiktokHandle ? (
                <li>
                  <p className="text-xs font-medium text-tt">TikTok</p>
                  <a href={ttProfileUrl(c.tiktokHandle)} target="_blank" rel="noopener noreferrer" className="break-all hover:underline">@{c.tiktokHandle} ↗</a>
                  {!c.doNotContact && <p className="text-xs text-muted">DM from their profile in the TikTok app.</p>}
                </li>
              ) : null}
              {c.email ? (
                <li>
                  <p className="text-xs font-medium text-info">Email</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="break-all">{c.email}</span>
                    <CreatorCopyButton text={c.email} />
                  </div>
                </li>
              ) : null}
              {!c.instagramHandle && !c.tiktokHandle && !c.email && <li className="text-muted">No handles or email yet. Add one below.</li>}
            </ul>
          </Card>

          <Card title="Stats">
            <dl className="grid grid-cols-3 gap-3 text-center">
              <div>
                <dt className="text-xs text-muted">IG followers</dt>
                <dd className="text-lg font-semibold tabular-nums">{formatNumber(c.instagramFollowers)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">TikTok followers</dt>
                <dd className="text-lg font-semibold tabular-nums">{formatNumber(c.tiktokFollowers)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Engagement</dt>
                <dd className="text-lg font-semibold tabular-nums">{c.engagementRate != null ? `${c.engagementRate.toFixed(1)}%` : "—"}</dd>
              </div>
            </dl>
            <p className="mt-3 text-xs text-muted">
              {c.statsUpdatedAt ? `Updated ${formatDate(c.statsUpdatedAt)} (${relativeTime(c.statsUpdatedAt, now)})` : "Not recorded yet."} Follower counts change — refresh before pitching.
            </p>
          </Card>

          <Card title="Notes">
            {c.notes ? <p className="whitespace-pre-wrap text-sm">{c.notes}</p> : <p className="text-sm text-muted">No notes yet.</p>}
          </Card>

          <Card title="Do not contact">
            <p className="text-sm text-muted">
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

        {/* Right: outreach per business */}
        <div className="space-y-5">
          <h2 className="text-lg font-semibold">Outreach</h2>
          {outreach.length === 0 ? (
            <EmptyState title="Not in outreach with any business yet">Add them to a business below to start a pipeline.</EmptyState>
          ) : (
            outreach.map((o) => <OutreachCard key={o.id} o={o} creatorId={c.id} drafts={draftsFor(o)} now={now} />)
          )}

          <Card title="Add to another business">
            {available.length === 0 ? (
              <p className="text-sm text-muted">Already in outreach with every business.</p>
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
                <div className="flex items-end">
                  <SubmitButton pendingLabel="Adding…">Add</SubmitButton>
                </div>
              </ActionForm>
            )}
          </Card>
        </div>
      </div>

      <section id="edit" className="mt-8 scroll-mt-6">
        <Card title="Edit profile">
          <ActionForm action={updateCreatorAction.bind(null, c.id)} ariaLabel="Edit creator profile" className="space-y-4">
            <CreatorFields creator={c} />
            <p className="text-xs text-muted">Clearing a field removes it. Changing follower counts or engagement updates the “stats updated” date.</p>
            <SubmitButton>Save profile</SubmitButton>
          </ActionForm>
        </Card>
      </section>
    </>
  );
}

function OutreachCard({ o, creatorId, drafts, now }: { o: OutreachWithClient; creatorId: string; drafts: Draft[]; now: Date }) {
  const due = isFollowUpDue(o, now);
  const showFtc = AGREED_STAGES.includes(o.stage);
  const idp = `o-${o.id}`;
  return (
    <Card
      title={
        <Link href={`/clients/${o.clientId}`} className="hover:underline">{clientLabel(o.client)}</Link>
      }
      actions={
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {due && <Badge tone="warn">Follow up due</Badge>}
          <StatusBadge status={o.stage} />
        </div>
      }
    >
      <dl className="mb-4 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
        <div><dt className="text-muted">Channel</dt><dd><PlatformTag platform={o.channel} /></dd></div>
        <div><dt className="text-muted">Comp</dt><dd>{COMP_LABEL[o.compType] ?? humanize(o.compType)}</dd></div>
        <div><dt className="text-muted">First contacted</dt><dd>{o.contactedAt ? formatDate(o.contactedAt) : "Not yet"}</dd></div>
        <div><dt className="text-muted">Last activity</dt><dd>{o.lastActivityAt ? relativeTime(o.lastActivityAt, now) : "—"}</dd></div>
      </dl>

      {showFtc && (
        <div role="note" className="mb-4 rounded-lg border border-warn/30 bg-warn-soft p-3 text-sm">
          <p className="font-medium text-warn">Disclosure reminder</p>
          <p className="mt-1">
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
          <label className="label" htmlFor={`${idp}-disc`}>Their post clearly says gifted/#ad</label>
          <select id={`${idp}-disc`} name="disclosureOk" className="input" defaultValue={o.disclosureOk === true ? "yes" : o.disclosureOk === false ? "no" : ""}>
            <option value="">Not checked yet</option>
            <option value="yes">Yes, clearly disclosed</option>
            <option value="no">No — ask them to add it</option>
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor={`${idp}-notes`}>Notes</label>
          <textarea id={`${idp}-notes`} name="notes" className="input" defaultValue={o.notes ?? ""} placeholder="What they said, visit date, what they ordered…" />
        </div>
        <div className="sm:col-span-2">
          <SubmitButton size="sm">Save</SubmitButton>
        </div>
      </ActionForm>

      <div className="mt-5 border-t border-border pt-4">
        <h3 className="mb-2 text-xs font-semibold text-muted">Drafts</h3>
        {drafts.length === 0 ? (
          <p className="text-sm text-muted">No drafts yet. Ask Claude to draft a {o.channel === "email" ? "pitch email" : "DM"} for {o.client.name}.</p>
        ) : (
          <ul className="divide-y divide-border">
            {drafts.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">{d.title}</p>
                  <p className="text-xs text-muted">
                    {d.kind === "outreach_email" ? "Email" : "DM"} · {d.sentAt ? `sent ${formatDate(d.sentAt)}` : `created ${relativeTime(d.createdAt, new Date())}`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={d.status} />
                  {(d.status === "needs_review" || d.status === "approved" || d.status === "failed") && (
                    <Link href={`/review#${d.id}`} className="text-xs text-accent hover:underline">
                      {d.status === "needs_review" ? "Review" : d.status === "approved" ? "Send" : "Fix"} →
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
