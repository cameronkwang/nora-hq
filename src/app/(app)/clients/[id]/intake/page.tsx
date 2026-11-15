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
import { Card, EmptyState, PageHeader, Status, Tag } from "@/components/ui";

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

  const back = <Link href={`/clients/${id}`}>{client.name}</Link>;

  if (!intake) {
    return (
      <>
        <PageHeader crumb={back} title="Onboarding form" subtitle="Nothing sent back yet." />
        <div className="biz-measure">
          <EmptyState title="No answers yet">When {client.name} sends the form, their answers show up here and Claude gets an ask to turn them into a brand voice and first-month plan.</EmptyState>
          <ClientIntakeCard clientId={id} clientName={client.name} />
        </div>
      </>
    );
  }

  const groups = intakeAnswerGroups(intake.answers, intake.id);
  const access = intakeAccessChecklist(intake.answers);
  const all = intakeAnswersText(client.name, intake);

  return (
    <>
      <PageHeader
        crumb={back}
        title="Onboarding form"
        subtitle={
          <span className="flex flex-wrap items-baseline gap-x-2.5">
            <span>Sent by the client {intake.submittedAt ? formatDate(intake.submittedAt, true) : ""}</span>
            {intake.lang && <Tag bare>Answered in {INTAKE_LANG_TAG[intake.lang]}</Tag>}
          </span>
        }
        actions={<CopyButton text={all} label="Copy all" size="sm" />}
      />
      <p className="meta -mt-4 mb-7 max-md:-mt-2 max-md:mb-5">Typed by the client and shown as written. Labels are in English; answers are in their words.</p>

      <div className="biz-measure">
        <div>
          <Card title="Access checklist" padded={false}>
            <ul className="list">
              {access.map((a) => (
                <li key={a.platform} className="row">
                  <span className="row-title is-plain">{a.platform}</span>
                  <Status tone={ACCESS_TONE[a.status]} className="whitespace-normal text-right">{a.label}</Status>
                </li>
              ))}
            </ul>
          </Card>

          {groups.map((g) => (
            <Card key={g.title} title={g.title} padded={false}>
              <dl className="kv is-wide">
                {g.items.map((item, i) => (
                  <div key={`${item.label}-${i}`}>
                    <dt>{item.label}</dt>
                    <dd className={item.multiline ? "whitespace-pre-wrap" : undefined}>
                      {item.href ? (
                        <a href={item.href} target="_blank" rel="noopener noreferrer nofollow" className="link break-all">{item.value}</a>
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
      </div>
    </>
  );
}
