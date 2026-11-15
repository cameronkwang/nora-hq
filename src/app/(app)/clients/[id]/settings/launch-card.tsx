import type { schema } from "@/lib/db";
import { launchInfo, openingLine } from "@/lib/launch";
import { ActionForm, SubmitButton } from "@/components/client-form";
import { Card, Status } from "@/components/ui";
import { saveLaunchAction } from "./launch-actions";

/**
 * Settings → Pre-launch. For a business that isn't open yet: tick "Not open yet" and pick the opening day.
 * It then gets a short launch checklist on its page (Google profile, bios, coming-soon posts, opening-day creators)
 * and no monthly checklist tasks until opening day. Untick it once they're open.
 */
export function LaunchSettingsCard({ client }: { client: schema.Client }) {
  const info = launchInfo(client);
  return (
    <Card title="Pre-launch" padded={false}>
      {info.prelaunch && (
        <p className="pb-1">
          <Status tone={info.opened ? "warn" : "info"} small className="whitespace-normal">{openingLine(info)}</Status>
        </p>
      )}
      <p className="sec-note">
        For a business that isn&apos;t open yet. It gets a short launch checklist on its page instead of the monthly plan: monthly checklist tasks start on opening day, and untouched ones for this month are cleared until then.
      </p>
      <ActionForm action={saveLaunchAction.bind(null, client.id)} className="flex flex-col gap-3" ariaLabel="Pre-launch">
        <label className="opt mr-0 self-start font-medium">
          <input type="checkbox" name="prelaunch" defaultChecked={client.prelaunch} className="check" />
          Not open yet
        </label>
        <div>
          <label className="label" htmlFor="s-opening">Opening day</label>
          <input id="s-opening" name="openingDate" type="date" defaultValue={client.openingDate ?? ""} className="input sm:max-w-56" />
          <p className="hint">
            {info.opened
              ? "Opening day is here or has passed. Untick “Not open yet” once they're open."
              : "Leave it empty if the date isn't set yet. You can add it later."}
          </p>
        </div>
        <div>
          <SubmitButton size="sm" variant="secondary">Save</SubmitButton>
        </div>
      </ActionForm>
    </Card>
  );
}
