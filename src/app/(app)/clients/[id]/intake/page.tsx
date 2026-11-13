import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { formatDate } from "@/lib/dates";
import { INTAKE_LANG_TAG } from "@/lib/intake-copy";
import { getClientIntake, intakeAccessChecklist, intakeAnswerGroups, intakeAnswersText, type AccessCheck } from "@/lib/ops-intake";
import { ClientIntakeCard } from "@/components/client-intake-card";
import { CopyButton } from "@/components/copy-button";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

/** Team view of a client's onboarding form answers. The client's text is shown exactly as typed (plain text, never HTML). */

const ACCESS_TONE: Record<AccessCheck["status"], "ok" | "warn" | "info" | "neutral"> = {
  done: "ok", help: "warn", call: "info", none: "neutral", unanswered: "neutral",
};

export default async function ClientIntakePage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }] = await Promise.all([params, requireUser()]);
  const db = await getDb();
  const [client] = await db.select({ id: schema.clients.id, name: schema.clients.name }).from(schema.clients).where(eq(schema.clients.id, id));
  if (!client) notFound();
  const intake = await getClientIntake(id);

  const back = (
    <p className="mb-1 text-xs text-muted">
      <Link href={`/clients/${id}`} className="hover:underline">{client.name}</Link>
    </p>
  );

  if (!intake) {
    return (
      <>
        {back}
        <PageHeader title="Onboarding form" subtitle="Nothing sent back yet." />
        <div className="grid gap-6">
          <ClientIntakeCard clientId={id} clientName={client.name} />
          <EmptyState title="No answers yet">When {client.name} sends the form, their answers show up here and Claude gets an ask to draft their brand voice.</EmptyState>
        </div>
      </>
    );
  }

  const groups = intakeAnswerGroups(intake.answers);
  const access = intakeAccessChecklist(intake.answers);
  const all = intakeAnswersText(client.name, intake);

  return (
    <>
      {back}
      <PageHeader
        title="Onboarding form"
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <span>Sent by the client {intake.submittedAt ? formatDate(intake.submittedAt, true) : ""}</span>
            {intake.lang && <Badge tone="info">Answered in {INTAKE_LANG_TAG[intake.lang]}</Badge>}
          </span>
        }
        actions={<CopyButton text={all} label="Copy all" variant="primary" />}
      />
      <p className="-mt-3 mb-5 text-xs text-muted">Typed by the client — shown as written. Labels are in English; answers are in their words.</p>

      <div className="grid gap-6">
        <Card title="Access checklist">
          <ul className="divide-y divide-border">
            {access.map((a) => (
              <li key={a.platform} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span>{a.platform}</span>
                <Badge tone={ACCESS_TONE[a.status]}>{a.label}</Badge>
              </li>
            ))}
          </ul>
        </Card>

        {groups.map((g) => (
          <Card key={g.title} title={g.title}>
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[minmax(10rem,14rem)_1fr]">
              {g.items.map((item, i) => (
                <div key={`${item.label}-${i}`} className="contents">
                  <dt className="text-xs font-semibold text-muted sm:pt-0.5">{item.label}</dt>
                  <dd className={item.multiline ? "whitespace-pre-wrap text-sm leading-relaxed" : "break-words text-sm"}>
                    {item.href ? (
                      <a href={item.href} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-accent hover:underline">{item.value}</a>
                    ) : (
                      item.value
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </Card>
        ))}

        <ClientIntakeCard clientId={id} clientName={client.name} />
      </div>
    </>
  );
}
