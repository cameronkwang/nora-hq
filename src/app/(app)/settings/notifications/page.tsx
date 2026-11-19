import Link from "next/link";
import { headers } from "next/headers";
import { assigneeFor, requireUser, seesDrafts } from "@/lib/auth";
import { relativeTime } from "@/lib/dates";
import { appUrl } from "@/lib/integrations/oauth";
import { noraNotificationsPaused, pushConfigured, vapidPublicKey } from "@/lib/notify";
import { setNoraPausedAction } from "./actions";
import { getCalendarFeed, listPushDevices } from "@/lib/ops-notify";
import { Button, Card, EmptyState, PageHeader, Status } from "@/components/ui";
import { ConfirmButton } from "@/components/client-form";
import { NotifyEnable } from "@/components/notify-enable";
import { NotifyDevices, type DeviceRow } from "@/components/notify-devices";
import { NotifyCalendarLink } from "@/components/notify-calendar";
import { revokeCalendarFeedAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function NotificationSettingsPage() {
  const user = await requireUser();
  const isCameron = assigneeFor(user) === "cameron";
  const [devices, feed, noraPaused] = await Promise.all([listPushDevices(user.email), getCalendarFeed(user.email), noraNotificationsPaused()]);
  const ready = pushConfigured();
  // APP_URL when set; otherwise the address this page was opened on (so the link is always usable).
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const base = appUrl() ?? (host ? `${h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")}://${host}` : "https://<your Nora HQ address>");
  const rows: DeviceRow[] = devices.map((d) => ({
    id: d.id, endpointKey: d.endpointKey, label: d.label, topics: d.topics,
    added: relativeTime(d.createdAt), lastSent: d.lastSentAt ? relativeTime(d.lastSentAt) : null,
  }));

  return (
    <div className="max-w-2xl">
      <PageHeader
        crumb={<Link href="/settings">Settings</Link>}
        title="Notifications & calendar"
        subtitle="Phone alerts for what needs you, and your Nora HQ dates in Apple or Google Calendar."
      />

      <div className="flex flex-col gap-10 max-md:gap-8">
        {isCameron && (
          <Card title="Nora’s notifications" actions={<Status tone={noraPaused ? "warn" : "ok"} small>{noraPaused ? "Paused" : "On"}</Status>}>
            <p className="mb-4 text-muted">
              {noraPaused
                ? "Nothing is sent to Nora's phone right now: no asks, reminders, collab alerts or tests from the app. Turn them on when she's ready."
                : "Nora gets the phone notifications she picked on her devices."}
            </p>
            <form action={setNoraPausedAction}>
              <input type="hidden" name="paused" value={noraPaused ? "0" : "1"} />
              {/* While Nora is paused, turning her back on is this page's one focal action (ink inside the app). */}
              <Button type="submit" variant={noraPaused ? "primary" : "secondary"}>
                {noraPaused ? "Turn Nora's notifications on" : "Pause Nora's notifications"}
              </Button>
            </form>
          </Card>
        )}

        <Card title="Phone notifications" actions={ready ? undefined : <Status tone="warn" small>Not set up</Status>}>
          {!ready && (
            <p className="notice">
              <Status tone="warn">Add VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT in Vercel first (docs/notifications.md).</Status>
            </p>
          )}
          <NotifyEnable publicKey={vapidPublicKey()} deviceKeys={devices.map((d) => d.endpointKey)} />
        </Card>

        <Card title="Your devices" padded={rows.length === 0}>
          {rows.length === 0 ? (
            <EmptyState title="No devices yet">Turn on notifications above on each phone or computer you use.</EmptyState>
          ) : (
            <>
              <p className="sec-note">Pick what each device gets. Changes save as you tap.</p>
              <NotifyDevices devices={rows} hideDrafts={!seesDrafts(user)} />
            </>
          )}
        </Card>

        <Card title="Calendar">
          <p className="mb-4 text-muted">
            Subscribe once and your calendar app shows collab visits (with address and notes), Nora&apos;s schedule
            (and a Monday line for reels still to post), scheduled posts, deliverable due dates and your own tasks
            with due dates. Updates on its own every hour or so.
          </p>
          {feed && (
            <div className="row mb-4 items-center border-y border-border">
              <div className="min-w-0 flex-1">
                <p className="row-title"><Status tone="ok" className="text-text">Link is on</Status></p>
                <p className="meta whitespace-normal">Made {relativeTime(feed.createdAt)} · {feed.lastFetchedAt ? `last checked by your calendar ${relativeTime(feed.lastFetchedAt)}` : "not added to a calendar yet"}</p>
              </div>
              <form action={revokeCalendarFeedAction}>
                <input type="hidden" name="id" value={feed.id} />
                <ConfirmButton confirm="Turn off your calendar link? Calendars using it stop updating.">Turn off</ConfirmButton>
              </form>
            </div>
          )}
          <NotifyCalendarLink base={base} hasFeed={!!feed} />
          <p className="meta mt-4">Lost the link? Make a new one. The old link stops working.</p>
        </Card>
      </div>
    </div>
  );
}
