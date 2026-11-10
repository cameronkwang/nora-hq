import Link from "next/link";
import { notFound } from "next/navigation";
import { getClient } from "@/lib/data";
import { schema } from "@/lib/db";
import { Badge, Card, EmptyState, PageHeader, humanize } from "@/components/ui";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/client-form";
import { deleteDeliverableAction, saveDeliverableAction, setArchivedAction, updateClientAction } from "../../actions";
import { listDeliverables } from "../../queries";

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

  return (
    <>
      <PageHeader
        title={
          <>
            <Link href={`/clients/${client.id}`} className="hover:underline">{client.name}</Link>
            <span className="text-muted"> · Settings</span>
          </>
        }
        subtitle={client.location ?? undefined}
        actions={client.archived ? <Badge>Archived</Badge> : undefined}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* Details & brand voice */}
        <Card title="Details">
          <ActionForm action={updateClientAction.bind(null, client.id)} className="flex flex-col gap-4" ariaLabel="Business details">
            <div className="grid gap-3 sm:grid-cols-2">
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

            <div>
              <label className="label" htmlFor="s-gloc">Google Business location</label>
              <input id="s-gloc" name="googleLocation" defaultValue={client.googleLocation ?? ""} className="input font-mono text-xs" placeholder="accounts/123…/locations/456…" autoCapitalize="none" spellCheck={false} />
              <p className="mt-1 text-xs text-muted">
                Needed to pull Google reviews. Looks like <code>accounts/…/locations/…</code>. After connecting Google in Settings, ask Claude to look it up, or copy it from the Business Profile API.
              </p>
            </div>

            <div>
              <label className="label" htmlFor="s-voice">Brand voice</label>
              <p id="s-voice-help" className="mb-1.5 text-xs text-muted">
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

            <div>
              <label className="label" htmlFor="s-notes">Notes</label>
              <textarea id="s-notes" name="notes" defaultValue={client.notes ?? ""} rows={4} className="input" placeholder="Contacts, owner preferences, posting rules…" />
            </div>

            <div>
              <SubmitButton>Save details</SubmitButton>
            </div>
          </ActionForm>
        </Card>

        <div className="flex flex-col gap-6">
          {/* Monthly plan */}
          <section id="plan" className="scroll-mt-4">
            <Card title="Monthly plan">
              <p className="mb-4 text-xs text-muted">
                What you deliver every month. Each item becomes checklist tasks on the business page. Target 0 means “as needed” (e.g. reply to every review).
              </p>

              {deliverables.length === 0 ? (
                <EmptyState title="No plan items yet">Add the first one below.</EmptyState>
              ) : (
                <ul className="flex flex-col gap-3">
                  {deliverables.map((d) => (
                    <li key={d.id} className={d.active ? "" : "opacity-70"}>
                      <ActionForm
                        action={saveDeliverableAction.bind(null, client.id, d.id)}
                        className="rounded-lg border border-border p-3"
                        ariaLabel={`Plan item: ${d.title}`}
                      >
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1fr)_8rem_5rem]">
                          <div className="col-span-2 sm:col-span-1">
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
                        </div>
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                          <label className="inline-flex items-center gap-2 text-sm">
                            <input type="checkbox" name="active" defaultChecked={d.active} className="size-4 accent-[var(--accent)]" />
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
              )}

              <ActionForm action={saveDeliverableAction.bind(null, client.id, null)} resetOnSuccess className="mt-4 rounded-lg bg-surface-2 p-3" ariaLabel="Add plan item">
                <p className="mb-2 text-sm font-medium">Add to plan</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1fr)_8rem_5rem]">
                  <div className="col-span-2 sm:col-span-1">
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
                </div>
                <div className="mt-2">
                  <SubmitButton size="sm" pendingLabel="Adding…">Add item</SubmitButton>
                </div>
              </ActionForm>
            </Card>
          </section>

          {/* Archive */}
          <Card title={client.archived ? "Archived" : "Archive"}>
            <form action={setArchivedAction.bind(null, client.id, !client.archived)} className="flex flex-col items-start gap-3">
              <p className="text-sm text-muted">
                {client.archived
                  ? "This business is hidden from the sidebar and lists. Its history is kept."
                  : "Stopped working with this business? Archiving hides it from the sidebar and lists. Nothing is deleted."}
              </p>
              {client.archived ? (
                <SubmitButton variant="secondary" pendingLabel="Restoring…">Restore business</SubmitButton>
              ) : (
                <ConfirmButton size="md" confirm={`Archive ${client.name}?`}>Archive business</ConfirmButton>
              )}
            </form>
          </Card>
        </div>
      </div>
    </>
  );
}
