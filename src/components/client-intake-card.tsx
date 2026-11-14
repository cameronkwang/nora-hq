import Link from "next/link";
import { eq } from "drizzle-orm";
import { formatDate } from "@/lib/dates";
import { getDb, schema } from "@/lib/db";
import { checkerName, factsChecklist, type FactsChecklist } from "@/lib/business-facts";
import { INTAKE_LANG_TAG } from "@/lib/intake-copy";
import { getClientIntakeStatus } from "@/lib/ops-intake";
import { IntakeSharePanel, type IntakeCardStatus } from "./intake-share-panel";
import { Badge, Card, buttonClass, cx } from "./ui";

/**
 * "Onboarding form" card for a business page (server component; the integrator mounts it):
 *   <ClientIntakeCard clientId={client.id} clientName={client.name} />
 * Shows where the client's private form link is (not sent · sent · opened · answers in), makes and copies links
 * with ready-to-paste texts in English, 简体 and 繁體, turns links off, and links to the answers.
 * Before the form is back it also shows the prefill checklist — what the form can already show the owner, what's
 * missing — with a gentle "not researched yet" hint and a preview of the owner's view. It never blocks sending.
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
        ? { kind: latest.status, id: latest.id, line: latest.status === "opened" && latest.openedAt ? `Opened ${formatDate(latest.openedAt, true)} — they've started` : `Link made ${formatDate(latest.createdAt)} · not opened yet` }
        : { kind: "off", line: latest.status === "expired" ? "The last link expired." : "The last link was turned off." };

  return (
    <Card
      title="Onboarding form"
      className={className}
      actions={submitted ? <Badge tone="ok">Answers in</Badge> : latest?.status === "opened" ? <Badge tone="info">Opened</Badge> : latest?.status === "sent" ? <Badge tone="accent">Sent</Badge> : null}
    >
      {submitted ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-ok-soft px-3 py-2 text-sm">
          <span>
            Answers in {submitted.submittedAt ? formatDate(submitted.submittedAt) : ""}
            {submitted.lang && <span className="ml-1.5 rounded-full bg-surface px-1.5 py-0.5 text-xs text-muted">Answered in {INTAKE_LANG_TAG[submitted.lang]}</span>}
          </span>
          <Link href={`/clients/${clientId}/intake`} className={cx(buttonClass("primary", "sm"))}>View answers</Link>
        </div>
      ) : (
        <p className="mb-3 text-sm text-muted">
          A private link the owner opens on their phone (English · 简体 · 繁體, no passwords). Page 1 takes under a minute: they check what we found, add their name and a phone or email, and can send. Two more pages are optional.
        </p>
      )}
      {/* Shown whenever a form could still go out or come back (also a fresh one after an earlier form was answered). */}
      {latest?.status !== "submitted" && check && <PrefillChecklist clientId={clientId} check={check} />}
      <IntakeSharePanel clientId={clientId} clientName={clientName} status={status} />
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

/** What the owner will be shown instead of asked, what's missing, and a link to see it as they will. */
function PrefillChecklist({ clientId, check }: { clientId: string; check: FactsChecklist }) {
  const names = (list: { label: string }[]) => list.map((x) => x.label).join(" · ");
  return (
    <div data-intake-prefill="" className="mb-3 rounded-lg border border-border p-3 text-sm">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="font-medium">Before you send: what the form already knows</p>
        <a href={`/start-preview/${clientId}`} target="_blank" rel="noopener" className="text-accent hover:underline">Preview what the owner sees</a>
      </div>
      <dl className="space-y-1">
        <div className="flex gap-2">
          <dt className="w-24 shrink-0 text-xs font-semibold text-muted sm:pt-0.5">We know</dt>
          <dd className="min-w-0 flex-1">{check.known.length ? names(check.known) : "Only the name so far"}</dd>
        </div>
        {check.missing.length > 0 && (
          <div className="flex gap-2">
            <dt className="w-24 shrink-0 text-xs font-semibold text-muted sm:pt-0.5">Missing</dt>
            <dd className="min-w-0 flex-1">{names(check.missing)}</dd>
          </div>
        )}
        {check.notFound.length > 0 && (
          <div className="flex gap-2">
            <dt className="w-24 shrink-0 text-xs font-semibold text-muted sm:pt-0.5">Not found</dt>
            <dd className="min-w-0 flex-1 text-muted">{names(check.notFound)}</dd>
          </div>
        )}
      </dl>
      {check.missing.length > 0 ? (
        <p data-intake-hint="" className="mt-2 rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn">
          {check.checkedAt ? "Not fully researched yet." : "Not researched yet."} Ask Claude to look up their public details first, or add them in{" "}
          <Link href={`/clients/${clientId}/settings#facts`} className="underline underline-offset-2">Settings</Link>, so the owner only has to tap “Yes, that&apos;s right”. You can still send it now.
        </p>
      ) : (
        <p data-intake-hint="" className="mt-2 text-xs text-muted">
          Researched{check.checkedAt ? ` ${formatDate(check.checkedAt)}` : ""}{check.checkedBy ? ` by ${checkerName(check.checkedBy)}` : ""}. The owner sees these on one “Is this right?” card.{" "}
          <Link href={`/clients/${clientId}/settings#facts`} className="text-accent hover:underline">Edit facts</Link>
        </p>
      )}
    </div>
  );
}
