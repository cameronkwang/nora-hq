import Link from "next/link";
import { headers } from "next/headers";
import { requireUser } from "@/lib/auth";
import { relativeTime } from "@/lib/dates";
import { appUrl } from "@/lib/integrations/oauth";
import { pushConfigured, vapidPublicKey } from "@/lib/notify";
import { getCalendarFeed, listPushDevices } from "@/lib/ops-notify";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { ConfirmButton } from "@/components/client-form";
import { NotifyEnable } from "@/components/notify-enable";
import { NotifyDevices, type DeviceRow } from "@/components/notify-devices";
import { NotifyCalendarLink } from "@/components/notify-calendar";
import { revokeCalendarFeedAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function NotificationSettingsPage() {
  const user = await requireUser();
  const [devices, feed] = await Promise.all([listPushDevices(user.email), getCalendarFeed(user.email)]);
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
    <div className="mx-auto max-w-2xl">
      <p className="mb-2 text-sm"><Link href="/settings" className="text-muted hover:underline">← Settings</Link></p>
      <PageHeader title="Notifications & calendar" subtitle="Phone alerts for what needs you, and your Nora HQ dates in Apple or Google Calendar." />

      <div className="flex flex-col gap-6">
        <Card title="Phone notifications" actions={ready ? undefined : <Badge tone="warn">Not set up</Badge>}>
          {!ready && (
            <p className="mb-3 rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn">
              Add VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT in Vercel first (docs/notifications.md).
            </p>
          )}
          <NotifyEnable publicKey={vapidPublicKey()} deviceKeys={devices.map((d) => d.endpointKey)} />
        </Card>

        <Card title="Your devices">
          {rows.length === 0 ? (
            <EmptyState title="No devices yet">Turn on notifications above on each phone or computer you use.</EmptyState>
          ) : (
            <>
              <p className="text-sm text-muted">Pick what each device gets. Changes save as you tap.</p>
              <NotifyDevices devices={rows} />
            </>
          )}
        </Card>

        <Card title="Calendar">
          <p className="mb-3 text-sm text-muted">
            Subscribe once and your calendar app shows collab visits (with address and notes), scheduled posts,
            deliverable due dates and your own tasks with due dates. Updates on its own every hour or so.
          </p>
          {feed && (
            <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-medium">Link is on</p>
                <p className="text-xs text-muted">Made {relativeTime(feed.createdAt)} · {feed.lastFetchedAt ? `last checked by your calendar ${relativeTime(feed.lastFetchedAt)}` : "not added to a calendar yet"}</p>
              </div>
              <form action={revokeCalendarFeedAction}>
                <input type="hidden" name="id" value={feed.id} />
                <ConfirmButton confirm="Turn off your calendar link? Calendars using it stop updating.">Turn off</ConfirmButton>
              </form>
            </div>
          )}
          <NotifyCalendarLink base={base} hasFeed={!!feed} />
          <p className="mt-3 text-xs text-muted">Lost the link? Make a new one — the old link stops working.</p>
        </Card>
      </div>
    </div>
  );
}
