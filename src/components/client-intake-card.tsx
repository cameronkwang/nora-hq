import Link from "next/link";
import { formatDate } from "@/lib/dates";
import { INTAKE_LANG_TAG } from "@/lib/intake-copy";
import { getClientIntakeStatus } from "@/lib/ops-intake";
import { IntakeSharePanel, type IntakeCardStatus } from "./intake-share-panel";
import { Badge, Card, buttonClass, cx } from "./ui";

/**
 * "Onboarding form" card for a business page (server component; the integrator mounts it):
 *   <ClientIntakeCard clientId={client.id} clientName={client.name} />
 * Shows where the client's private form link is (not sent · sent · opened · answers in), makes and copies links
 * with ready-to-paste texts in English, 简体 and 繁體, turns links off, and links to the answers.
 */
export async function ClientIntakeCard({ clientId, clientName, className }: { clientId: string; clientName: string; className?: string }) {
  const { latest, submitted } = await getClientIntakeStatus(clientId).catch((e) => {
    console.error("[intake] status failed", e);
    return { latest: null, submitted: null };
  });

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
          A private link where the owner tells us about their restaurant (English · 简体 · 繁體, about 10 minutes, no passwords).
        </p>
      )}
      <IntakeSharePanel clientId={clientId} clientName={clientName} status={status} />
    </Card>
  );
}
