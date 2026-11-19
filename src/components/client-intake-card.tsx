import Link from "next/link";
import { eq } from "drizzle-orm";
import { formatDate } from "@/lib/dates";
import { getDb, schema } from "@/lib/db";
import { checkerName, factsChecklist, type FactsChecklist } from "@/lib/business-facts";
import { INTAKE_LANG_TAG } from "@/lib/intake-copy";
import { getClientIntakeStatus } from "@/lib/ops-intake";
import { IntakeSharePanel, type IntakeCardStatus } from "./intake-share-panel";
import { Card, Status, Tag, buttonClass } from "./ui";

/**
 * "Onboarding form" section for a business page (server component; the integrator mounts it):
 *   <ClientIntakeCard clientId={client.id} clientName={client.name} />
 * Shows where the client's private form link is (not sent · sent · opened · answers in), makes and copies links
 * with ready-to-paste texts in English, 简体 and 繁體, turns links off, and links to the answers.
 * Before the form is back it also shows the prefill checklist (what the form can already show the owner, what's
 * missing) with a gentle "not researched yet" hint and a preview of the owner's view. It never blocks sending.
 */
export async function ClientIntakeCard({ clientId, clientName, className }: { clientId: string; clientName: string; className?: string }) {
  const [{ latest, submitted }, check] = await Promise.all([
    getClientIntakeStatus(clientId).catch((e) => {
      console.error("[intake] status failed", e);
      return { latest: null, submitted: null };
    }),
    prefill(clientId),
  ]);

  const status: IntakeCardStatus = !latest
    ? { kind: "none" }
    : latest.status === "submitted"
      ? { kind: "submitted", id: latest.id }
      : latest.status === "sent" || latest.status === "opened"
        ? { kind: latest.status, id: latest.id, line: latest.status === "opened" && latest.openedAt ? `Opened ${formatDate(latest.openedAt, true)}: they've started` : `Link made ${formatDate(latest.createdAt)} · not opened yet` }
        : { kind: "off", line: latest.status === "expired" ? "The last link expired." : "The last link was turned off." };

  return (
    <Card
      title="Onboarding form"
      className={className}
      actions={submitted ? <Status tone="ok" small>Answers in</Status> : latest?.status === "opened" ? <Status tone="info" small>Opened</Status> : latest?.status === "sent" ? <Status small>Sent</Status> : null}
    >
      {submitted ? (
        <p className="mb-3">
          Answers in {submitted.submittedAt ? formatDate(submitted.submittedAt) : ""}
          {submitted.lang && <Tag>Answered in {INTAKE_LANG_TAG[submitted.lang]}</Tag>}
        </p>
      ) : (
        <p className="meta mb-3">
          A private link the owner opens on their phone (English · 简体 · 繁體, no passwords). Page 1 takes under a minute: they check what we found, add their name and a phone or email, and can send. Two more pages are optional.
        </p>
      )}
      {/* Shown whenever a form could still go out or come back (also a fresh one after an earlier form was answered). */}
      {latest?.status !== "submitted" && check && <PrefillChecklist clientId={clientId} check={check} out={latest?.status === "sent" || latest?.status === "opened"} />}
      <IntakeSharePanel
        clientId={clientId}
        clientName={clientName}
        status={status}
        lead={submitted ? <Link href={`/clients/${clientId}/intake`} className={buttonClass("secondary")}>View answers</Link> : null}
      />
    </Card>
  );
}

async function prefill(clientId: string): Promise<FactsChecklist | null> {
  try {
    const db = await getDb();
    const [c] = await db.select().from(schema.clients).where(eq(schema.clients.id, clientId));
    return c && c.kind !== "creator" ? factsChecklist(c) : null;
  } catch (e) {
    console.error("[intake] prefill checklist failed", e);
    return null;
  }
}

/**
 * What the owner will be shown instead of asked, what's missing, and a link to see it as they will.
 * `out`: a link is already with the owner (sent or opened), so nothing here talks about sending it.
 */
function PrefillChecklist({ clientId, check, out }: { clientId: string; check: FactsChecklist; out: boolean }) {
  const names = (list: { label: string }[]) => list.map((x) => x.label).join(" · ");
  return (
    <div data-intake-prefill="" className="mb-4">
      <p className="font-medium">What the form already knows</p>
      <dl className="kv mt-1">
        <div>
          <dt>We know</dt>
          <dd>{check.known.length ? names(check.known) : "Only the name so far"}</dd>
        </div>
        {check.missing.length > 0 && (
          <div>
            <dt>Missing</dt>
            <dd>{names(check.missing)}</dd>
          </div>
        )}
        {check.notFound.length > 0 && (
          <div>
            <dt>Not found</dt>
            <dd className="text-muted">{names(check.notFound)}</dd>
          </div>
        )}
      </dl>
      {check.missing.length > 0 ? (
        <p data-intake-hint="" className="status is-warn is-small mt-1 flex whitespace-normal border-t border-border pt-2.5">
          <span>
            {check.checkedAt ? "Not fully researched yet." : "Not researched yet."} Ask Claude to look up their public details first, or add them in{" "}
            <Link href={`/clients/${clientId}/settings#facts`} className="link">Settings</Link>, so the owner only has to tap “Yes, that&apos;s right”.{!out && " You can still send it now."}
          </span>
        </p>
      ) : (
        <p data-intake-hint="" className="meta mt-1 border-t border-border pt-2.5">
          Researched{check.checkedAt ? ` ${formatDate(check.checkedAt)}` : ""}{check.checkedBy ? ` by ${checkerName(check.checkedBy)}` : ""}. The owner sees these on one “Is this right?” card.{" "}
          <Link href={`/clients/${clientId}/settings#facts`} className="link">Edit facts</Link>
        </p>
      )}
      <p className="meta mt-2">
        <a href={`/start-preview/${clientId}`} target="_blank" rel="noopener" className="link">Preview what the owner sees</a>
      </p>
    </div>
  );
}
