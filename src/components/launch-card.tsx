import Link from "next/link";
import type { Client } from "@/lib/schema";
import { launchInfo, openingLine } from "@/lib/launch";
import { getLaunchStatus } from "@/lib/ops-launch";
import { markOpenAction } from "@/app/(app)/clients/[id]/settings/launch-actions";
import { SubmitButton } from "./client-form";
import { TaskRow } from "./task-row";
import { Card, ProgressBar, Status } from "./ui";

/**
 * "Launch checklist" section on a business page, for a business that isn't open yet (Settings → Pre-launch).
 * Shows how long until opening day and the short launch checklist (tasks tagged "launch"); the monthly plan waits
 * until then. Once opening day is here it offers "They're open", which takes the business out of pre-launch and
 * creates the month's plan tasks.
 * Renders nothing for a business that is open.
 *   <LaunchCard client={client} />
 */
export async function LaunchCard({ client, className }: { client: Client; className?: string }) {
  const info = launchInfo(client);
  if (!info.prelaunch) return null;
  const launch = await getLaunchStatus(client.id);
  const soon = info.daysToOpening != null && info.daysToOpening <= 7;

  return (
    <Card
      title="Launch checklist"
      className={className}
      padded={false}
      actions={<Status tone={info.opened || soon ? "warn" : "info"} small className="whitespace-normal">{openingLine(info)}</Status>}
    >
      <p className="sec-note">
        {info.opened
          ? `${client.name}'s opening day is here.`
          : `${client.name} isn't open yet. Until they open, this is the work.`}
        {!info.openingDate && (
          <>
            {" "}
            <Link href={`/clients/${client.id}/settings#launch`} className="link">Add the opening day</Link>
          </>
        )}
      </p>

      {info.opened && (
        <form action={markOpenAction.bind(null, client.id, info.openingDate)} className="notice mb-3 items-center">
          <p className="status is-warn min-w-0 flex-1 basis-56 whitespace-normal">Are they open? This takes them out of pre-launch and creates the month&apos;s checklist.</p>
          <SubmitButton size="sm" pendingLabel="Saving…">They&apos;re open</SubmitButton>
        </form>
      )}

      {launch.total > 0 ? (
        <>
          <div className="biz-progress">
            <ProgressBar value={launch.done} max={launch.total} />
            <span className="meta num"><b>{launch.done}</b> of {launch.total} done</span>
          </div>
          <ul className="list is-ruled border-b-0">
            {launch.tasks.map((t) => (
              <li key={t.id}>
                <TaskRow task={t} clientName={client.name} showClient={false} />
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="meta pb-2">No launch steps left on the list.</p>
      )}
    </Card>
  );
}
