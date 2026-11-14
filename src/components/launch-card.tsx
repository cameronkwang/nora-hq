import Link from "next/link";
import type { Client } from "@/lib/schema";
import { launchInfo, openingLine } from "@/lib/launch";
import { getLaunchStatus } from "@/lib/ops-launch";
import { markOpenAction } from "@/app/(app)/clients/[id]/settings/launch-actions";
import { SubmitButton } from "./client-form";
import { TaskRow } from "./task-row";
import { Badge, Card, ProgressBar } from "./ui";

/**
 * "Launch checklist" card on a business page, for a business that isn't open yet (Settings → Pre-launch).
 * Shows how long until opening day and the short launch checklist (tasks tagged "launch"); the monthly plan waits
 * until then. Once opening day is here it offers "They're open", which hands the business back to the normal plan.
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
      actions={<Badge tone={info.opened || soon ? "warn" : "info"}>{openingLine(info)}</Badge>}
    >
      <p className="-mt-1 mb-3 text-sm text-muted">
        {info.opened
          ? `${client.name}'s opening day is here. The monthly plan applies again.`
          : `${client.name} isn't open yet. Until opening day this is the work; the monthly plan starts then.`}
        {!info.openingDate && (
          <>
            {" "}
            <Link href={`/clients/${client.id}/settings#launch`} className="text-accent hover:underline">Add the opening day</Link>
          </>
        )}
      </p>

      {info.opened && (
        <form action={markOpenAction.bind(null, client.id, info.openingDate)} className="mb-3 flex flex-wrap items-center gap-3 rounded-lg bg-warn-soft px-3 py-2">
          <p className="min-w-0 flex-1 text-sm text-warn">Are they open? This takes them out of pre-launch.</p>
          <SubmitButton size="sm" pendingLabel="Saving…">They&apos;re open</SubmitButton>
        </form>
      )}

      {launch.total > 0 ? (
        <>
          <div className="mb-1 flex items-center justify-between gap-3 text-xs text-muted">
            <span className="tabular-nums">{launch.done} of {launch.total} done</span>
          </div>
          <ProgressBar value={launch.done} max={launch.total} />
          <ul className="mt-2 divide-y divide-border">
            {launch.tasks.map((t) => (
              <li key={t.id}>
                <TaskRow task={t} clientName={client.name} showClient={false} />
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-sm text-muted">No launch steps left on the list.</p>
      )}
    </Card>
  );
}
