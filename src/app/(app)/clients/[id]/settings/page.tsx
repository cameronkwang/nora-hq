import Link from "next/link";
import { notFound } from "next/navigation";
import { getClient, isCreatorClient } from "@/lib/data";
import { schema } from "@/lib/db";
import { Card, EmptyState, PageHeader, Tag, cx, humanize } from "@/components/ui";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/client-form";
import { deleteDeliverableAction, saveDeliverableAction, updateClientAction } from "../../actions";
import { listDeliverables } from "../../queries";
import { setOwnerEmailAction } from "../../../reports/actions";
import { setBusinessActiveAction, setOutreachAreasAction } from "./actions";
import { ActiveToggle } from "./active-toggle";
import { NotesField } from "./notes-field";
import { FactsCard } from "./facts-card";
import { OutreachProfileCard } from "./outreach-profile-card";
import { LaunchSettingsCard } from "./launch-card";
import { OutreachAreasField } from "@/components/onboard-areas";
import { STARTING_PLAN_NOTE } from "@/lib/onboard-services";
import { ClientGoogleSync } from "@/components/google-sync-status";

export const dynamic = "force-dynamic";

const platformName = (p: string) => (p === "tiktok" ? "TikTok" : humanize(p));

function PlatformSelect({ id, defaultValue }: { id: string; defaultValue: string }) {
  return (
    <select id={id} name="platform" defaultValue={defaultValue} className="input">
      {schema.PLATFORMS.map((p) => (
        <option key={p} value={p}>{platformName(p)}</option>
      ))}
    </select>
  );
}

export default async function ClientSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const client = await getClient(id);
  if (!client) notFound();
  const deliverables = await listDeliverables(id);
  const business = !isCreatorClient(client);
  // The small, rarely changed settings sit in the side column. Nora's own workspace has none of them.
  const hasSide = business || client.archived;

  /* Details & brand voice */
  const details = (
    <Card title="Details">
      <ActionForm action={updateClientAction.bind(null, client.id)} className="flex flex-col gap-5" ariaLabel="Business details">
        <div className="grid gap-x-3 gap-y-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="s-name">Name</label>
            <input id="s-name" name="name" required defaultValue={client.name} className="input" />
          </div>
          <div>
            <label className="label" htmlFor="s-location">Location</label>
            <input id="s-location" name="location" defaultValue={client.location ?? ""} className="input" placeholder="e.g. Richmond" />
          </div>
          <div>
            <label className="label" htmlFor="s-brand">Brand group</label>
            <input id="s-brand" name="brand" defaultValue={client.brand ?? ""} className="input" placeholder="Shared by every location" />
          </div>
          <div>
            <label className="label" htmlFor="s-website">Website</label>
            <input id="s-website" name="website" defaultValue={client.website ?? ""} className="input" placeholder="example.com" inputMode="url" autoCapitalize="none" />
          </div>
          <div>
            <label className="label" htmlFor="s-ig">Instagram handle</label>
            <input id="s-ig" name="instagramHandle" defaultValue={client.instagramHandle ?? ""} className="input" placeholder="@handle" autoCapitalize="none" />
          </div>
          <div>
            <label className="label" htmlFor="s-tt">TikTok handle</label>
            <input id="s-tt" name="tiktokHandle" defaultValue={client.tiktokHandle ?? ""} className="input" placeholder="@handle" autoCapitalize="none" />
          </div>
        </div>

        <div hidden={client.kind === "creator"}>
          <label className="label" htmlFor="s-gloc">Google Business location</label>
          <input id="s-gloc" name="googleLocation" defaultValue={client.googleLocation ?? ""} className="input font-mono" placeholder="accounts/123…/locations/456…" autoCapitalize="none" spellCheck={false} />
          <p className="hint">
            Needed to pull Google reviews. Looks like <code>accounts/…/locations/…</code>. After connecting Google in Settings, ask Claude to look it up, or copy it from the Business Profile API.
          </p>
          {/* What the last review sync found for this business. */}
          <ClientGoogleSync client={client} prefix="Review sync" className="mt-2" />
        </div>

        <div>
          <label className="label" htmlFor="s-voice">Brand voice</label>
          <p id="s-voice-help" className="meta mb-2">
            Claude reads this before drafting anything for {client.name}: captions, review replies, creator outreach. Include the tone, signature dishes, whether to use emojis, and words to avoid.
          </p>
          <textarea
            id="s-voice"
            name="brandVoice"
            aria-describedby="s-voice-help"
            defaultValue={client.brandVoice ?? ""}
            rows={7}
            className="input"
            placeholder={"Tone: warm, playful, family-run.\nSignature dishes: …\nEmojis: yes, 1–2 per caption.\nAvoid: “authentic”, “mouthwatering”."}
          />
        </div>

        <NotesField defaultValue={client.notes ?? ""} />

        <div>
          <SubmitButton>Save details</SubmitButton>
        </div>
      </ActionForm>
    </Card>
  );

  /* Monthly plan */
  const plan = (
    <section id="plan" className="scroll-mt-4">
      <Card title="Monthly plan" padded={false}>
        <p className="sec-note">
          What you deliver every month. Each item becomes checklist tasks on the business page. Target 0 means “as needed” (e.g. reply to every review). New businesses get a {STARTING_PLAN_NOTE.replace(" — ", ": ")}. Facebook posts are posted by hand (auto-publish is Instagram only).
        </p>

        {deliverables.length === 0 ? (
          <EmptyState title="No plan items yet">Add the first one below.</EmptyState>
        ) : (
          <>
          {/* On a wide screen the field names are said once, as a caps header; each field keeps its own label for screen readers (and on a phone). */}
          <div className="plan-edit-head eyebrow" aria-hidden>
            <span>Item</span>
            <span>Platform</span>
            <span>Per month</span>
          </div>
          <ul className="list is-ruled plan-list">
            {deliverables.map((d) => (
              <li key={d.id} className={d.active ? undefined : "opacity-70"}>
                <ActionForm action={saveDeliverableAction.bind(null, client.id, d.id)} className="plan-edit" ariaLabel={`Plan item: ${d.title}`}>
                  <div className="f-title">
                    <label className="label" htmlFor={`d-title-${d.id}`}>Item</label>
                    <input id={`d-title-${d.id}`} name="title" required defaultValue={d.title} className="input" />
                  </div>
                  <div>
                    <label className="label" htmlFor={`d-plat-${d.id}`}>Platform</label>
                    <PlatformSelect id={`d-plat-${d.id}`} defaultValue={d.platform} />
                  </div>
                  <div>
                    <label className="label" htmlFor={`d-target-${d.id}`}>Per month</label>
                    <input id={`d-target-${d.id}`} name="targetPerMonth" type="number" min={0} max={999} step={1} defaultValue={d.targetPerMonth} className="input tabular-nums" />
                  </div>
                  <div className="f-foot">
                    <label className="opt mr-0">
                      <input type="checkbox" name="active" defaultChecked={d.active} className="check" />
                      Active
                    </label>
                    <div className="flex gap-2">
                      <ConfirmButton
                        confirm={`Remove “${d.title}” from the plan? Existing tasks stay.`}
                        formAction={deleteDeliverableAction.bind(null, client.id, d.id)}
                      >
                        Delete
                      </ConfirmButton>
                      <SubmitButton size="sm" variant="secondary">Save</SubmitButton>
                    </div>
                  </div>
                </ActionForm>
              </li>
            ))}
          </ul>
          </>
        )}

        <ActionForm action={saveDeliverableAction.bind(null, client.id, null)} resetOnSuccess className="plan-edit" ariaLabel="Add plan item">
          <p className="col-span-full font-medium">Add to plan</p>
          <div className="f-title">
            <label className="label" htmlFor="d-new-title">Item</label>
            <input id="d-new-title" name="title" required className="input" placeholder="e.g. Instagram reels" />
          </div>
          <div>
            <label className="label" htmlFor="d-new-plat">Platform</label>
            <PlatformSelect id="d-new-plat" defaultValue="instagram" />
          </div>
          <div>
            <label className="label" htmlFor="d-new-target">Per month</label>
            <input id="d-new-target" name="targetPerMonth" type="number" min={0} max={999} step={1} defaultValue={4} className="input tabular-nums" />
          </div>
          <div className="f-foot">
            <SubmitButton pendingLabel="Adding…">Add item</SubmitButton>
          </div>
        </ActionForm>
      </Card>
    </section>
  );

  return (
    <>
      <PageHeader
        crumb={<Link href={`/clients/${client.id}`}>{client.name}</Link>}
        title={
          <>
            Settings
            {client.archived && <Tag>Inactive</Tag>}
          </>
        }
        subtitle={client.location ?? undefined}
      />

      <div className={cx(hasSide ? "cols biz-cols" : "biz-measure")}>
        <div className="biz-col">
          {details}

          {/* Public facts: looked up before the onboarding form is sent, shown back to the owner as "Is this right?". */}
          {business && (
            <section id="facts" className="scroll-mt-4">
              <FactsCard client={client} />
            </section>
          )}

          {plan}
        </div>

        {hasSide && (
          <div className="biz-side is-tall">
            {/* Owner email: where an approved external monthly report is sent (only when a person presses Send). */}
            {business && (
              <section id="owner" className="scroll-mt-4">
                <Card title="Owner email">
                  <ActionForm action={setOwnerEmailAction.bind(null, client.id)} className="flex flex-col gap-3" ariaLabel="Owner email">
                    <div>
                      <label className="label" htmlFor="s-owner">Owner&apos;s email for monthly reports</label>
                      <input id="s-owner" name="ownerEmail" type="email" inputMode="email" autoCapitalize="none" autoComplete="off" defaultValue={client.ownerEmail ?? ""} className="input" placeholder="owner@business.com" />
                      <p className="hint">
                        Owners only get the external report you approve and send from <Link href={`/reports?client=${client.id}`} className="link">Reports</Link>. Nothing is sent automatically.
                      </p>
                    </div>
                    <div>
                      <SubmitButton>Save owner email</SubmitButton>
                    </div>
                  </ActionForm>
                </Card>
              </section>
            )}

            {/* Outreach profile: which account creator outreach is sent from (the business's own, not Nora's) and the standing offer. */}
            {business && (
              <section id="outreach-profile" className="scroll-mt-4">
                <OutreachProfileCard client={client} />
              </section>
            )}

            {/* Creator search areas: where Claude/Nora look for local creators to feature this business. */}
            {business && (
              <section id="creator-areas" className="scroll-mt-4">
                <Card title="Creator search areas">
                  <ActionForm action={setOutreachAreasAction.bind(null, client.id)} className="flex flex-col gap-3" ariaLabel="Creator search areas">
                    <OutreachAreasField
                      idPrefix="s"
                      defaultValue={client.outreachAreas}
                      label="Where should we look for creators?"
                      hint="Claude searches these areas when it researches local food creators for this business. Leave empty to use the business's city."
                    />
                    <div>
                      <SubmitButton>Save areas</SubmitButton>
                    </div>
                  </ActionForm>
                </Card>
              </section>
            )}

            {/* Pre-launch: not open yet, so a launch checklist instead of the monthly plan until opening day. */}
            {business && (
              <section id="launch" className="scroll-mt-4">
                <LaunchSettingsCard client={client} />
              </section>
            )}

            {/* Active / Inactive. Nora's own workspace is always active (only a switch back, if it was ever made inactive). */}
            <Card title="Status">
              <ActiveToggle active={!client.archived} action={setBusinessActiveAction.bind(null, client.id, !!client.archived)} />
              <p className="hint">
                {client.archived
                  ? "Turn it back on when you start working with them again. Its history is all here."
                  : "Stopped or paused working with this business? Switch it to Inactive. Nothing is deleted."}
              </p>
            </Card>
          </div>
        )}
      </div>
    </>
  );
}
