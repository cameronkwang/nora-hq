import type { schema } from "@/lib/db";
import { launchInfo, openingLine } from "@/lib/launch";
import { ActionForm, SubmitButton } from "@/components/client-form";
import { Badge, Card } from "@/components/ui";
import { saveLaunchAction } from "./launch-actions";

/**
 * Settings → Pre-launch. For a business that isn't open yet: tick "Not open yet" and pick the opening day.
 * It then gets a short launch checklist on its page (Google profile, bios, coming-soon posts, opening-day creators)
 * and no monthly checklist tasks until opening day. Untick it once they're open.
 */
export function LaunchSettingsCard({ client }: { client: schema.Client }) {
  const info = launchInfo(client);
  return (
    <Card title="Pre-launch" actions={info.prelaunch ? <Badge tone={info.opened ? "warn" : "info"}>{openingLine(info)}</Badge> : undefined}>
      <p className="mb-3 text-xs text-muted">
        For a business that isn&apos;t open yet. It gets a short launch checklist on its page instead of the monthly plan: monthly checklist tasks start on opening day, and untouched ones for this month are cleared until then.
      </p>
      <ActionForm action={saveLaunchAction.bind(null, client.id)} className="flex flex-col gap-3" ariaLabel="Pre-launch">
        <label className="inline-flex min-h-11 items-center gap-2 text-sm font-medium">
          <input type="checkbox" name="prelaunch" defaultChecked={client.prelaunch} className="size-4 accent-[var(--accent)]" />
          Not open yet
        </label>
        <div>
          <label className="label" htmlFor="s-opening">Opening day</label>
          <input id="s-opening" name="openingDate" type="date" defaultValue={client.openingDate ?? ""} className="input sm:max-w-56" />
          <p className="mt-1 text-xs text-muted">
            {info.opened
              ? "Opening day is here or has passed. Untick “Not open yet” once they're open."
              : "Leave it empty if the date isn't set yet. You can add it later."}
          </p>
        </div>
        <div>
          <SubmitButton size="sm">Save</SubmitButton>
        </div>
      </ActionForm>
    </Card>
  );
}
