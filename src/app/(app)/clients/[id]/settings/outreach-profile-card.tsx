import type { schema } from "@/lib/db";
import { SEND_FROM_KINDS } from "@/lib/schema";
import { SEND_FROM_LABEL } from "@/lib/outreach-profile";
import { ActionForm, SubmitButton } from "@/components/client-form";
import { Card } from "@/components/ui";
import { saveOutreachProfileAction } from "./outreach-profile-actions";

/**
 * Settings → Outreach profile. Creator outreach is written AS this business and sent from its own account, never
 * Nora's: this card says which account, and the standing offer Claude uses in every outreach draft.
 * The review queue and the send mode show both on each outreach message.
 */
export function OutreachProfileCard({ client }: { client: schema.Client }) {
  const ownHandle = client.instagramHandle ? `@${client.instagramHandle}` : client.tiktokHandle ? `@${client.tiktokHandle}` : "@theirhandle";
  return (
    <Card title="Outreach profile">
      <p className="mb-3 text-xs text-muted">
        Messages to creators are written as {client.name} and sent from {client.name}&apos;s own account, not Nora&apos;s. Claude uses the offer below in every outreach draft, and each draft shows which account to send it from.
      </p>
      <ActionForm action={saveOutreachProfileAction.bind(null, client.id)} className="flex flex-col gap-3" ariaLabel="Outreach profile">
        <div className="grid gap-3 sm:grid-cols-[9rem_minmax(0,1fr)]">
          <div>
            <label className="label" htmlFor="op-kind">Send from</label>
            <select id="op-kind" name="sendFromKind" defaultValue={client.sendFrom ? (client.sendFromKind ?? "other") : "instagram"} className="input">
              {SEND_FROM_KINDS.map((k) => (
                <option key={k} value={k}>{SEND_FROM_LABEL[k]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="op-from">Account</label>
            <input
              id="op-from"
              name="sendFrom"
              defaultValue={client.sendFrom ?? ""}
              maxLength={200}
              className="input"
              placeholder={ownHandle}
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        </div>
        <p className="-mt-1 text-xs text-muted">The @handle or email address only. Never a password: logins stay in a password manager.</p>
        <div>
          <label className="label" htmlFor="op-offer">Standing offer for creators</label>
          <input id="op-offer" name="creatorOffer" defaultValue={client.creatorOffer ?? ""} maxLength={300} className="input" placeholder="Free all-you-can-eat seafood boil for 2" autoComplete="off" />
          <p className="mt-1 text-xs text-muted">What the owner agreed to give a creator who visits. Leave empty if there isn&apos;t one yet.</p>
        </div>
        <div>
          <SubmitButton size="sm">Save outreach profile</SubmitButton>
        </div>
      </ActionForm>
    </Card>
  );
}
