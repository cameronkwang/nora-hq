import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq, sql } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { listClients } from "@/lib/data";
import { formatDate, relativeTime } from "@/lib/dates";
import { blobEnabled } from "@/lib/uploads";
import { CalendarPostForm } from "@/components/calendar-post-form";
import { MediaStrip } from "@/components/calendar-media";
import { CopyButton } from "@/components/copy-button";
import { Badge, Button, Card, PageHeader, PlatformTag, StatusBadge, clientLabel, cx, humanize } from "@/components/ui";
import { deletePostAction, markPublishedAction, schedulePostAction, setPostStatusAction } from "../actions";
import { utcToZoned } from "../tz";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function PostPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const msg = one(sp.msg);
  const tone = one(sp.tone);

  const db = await getDb();
  const [post] = await db.select().from(schema.contentPosts).where(eq(schema.contentPosts.id, id));
  if (!post) notFound();
  const [clients, drafts, task] = await Promise.all([
    listClients({ includeArchived: true }),
    db.select({ id: schema.drafts.id, title: schema.drafts.title, status: schema.drafts.status, createdAt: schema.drafts.createdAt })
      .from(schema.drafts)
      .where(sql`${schema.drafts.meta}->>'postId' = ${id}`)
      .orderBy(desc(schema.drafts.createdAt))
      .limit(5),
    post.taskId ? db.select({ id: schema.tasks.id, title: schema.tasks.title, status: schema.tasks.status }).from(schema.tasks).where(eq(schema.tasks.id, post.taskId)).then((r) => r[0] ?? null) : Promise.resolve(null),
  ]);
  const client = clients.find((c) => c.id === post.clientId);
  const pendingDraft = drafts.find((d) => d.status === "needs_review");
  const zoned = post.scheduledFor ? utcToZoned(post.scheduledFor) : null;

  const isIg = post.platform === "instagram";
  const canSchedule = isIg && post.publishMode === "auto" && !!post.scheduledFor && post.mediaUrls.length > 0 && !["scheduled", "publishing", "published"].includes(post.status);
  const scheduleBlockers = [
    post.publishMode !== "auto" && "set it to auto-publish",
    !post.scheduledFor && "pick a date and time",
    post.mediaUrls.length === 0 && "add a photo or video",
  ].filter(Boolean) as string[];
  const back = new URLSearchParams({ tab: "posts" });
  if (zoned) back.set("month", zoned.date.slice(0, 7));
  const backHref = back.size ? `/calendar?${back}` : "/calendar";
  const pastDue = post.scheduledFor && post.scheduledFor < new Date() && !["published", "publishing"].includes(post.status);

  return (
    <div>
      <Link href={backHref} className="mb-3 inline-block text-sm text-accent hover:underline">
        ← Calendar
      </Link>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {client ? clientLabel(client) : "Archived business"}
          </span>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <PlatformTag platform={post.platform} />
            <span>{humanize(post.format)}</span>
            <span>{post.scheduledFor ? formatDate(post.scheduledFor, true) + " ET" : "No date yet"}</span>
            <StatusBadge status={post.status} />
          </span>
        }
      />

      {msg && (
        <p role="status" className={cx("mb-4 rounded-lg px-4 py-3 text-sm", tone === "danger" ? "bg-danger-soft text-danger" : tone === "warn" ? "bg-warn-soft text-warn" : "bg-ok-soft text-ok")}>
          {msg}
        </p>
      )}
      {post.status === "failed" && (
        <div role="alert" className="mb-4 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">
          <p className="font-semibold">Publishing failed</p>
          <p className="mt-0.5 break-words">{post.error ?? "No error details were recorded."}</p>
          <p className="mt-1 text-xs">Fix the problem (often media links or the Instagram connection), then schedule it again or post it manually and mark it published.</p>
        </div>
      )}
      {pastDue && post.status !== "failed" && (
        <p className="mb-4 rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">
          {post.status === "scheduled" ? "This was due to publish already — it should go out on the next publishing run." : "The planned time has passed. Post it and mark it published, or move the date."}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card title="Edit post">
          <CalendarPostForm
            clients={clients.map((c) => ({ id: c.id, label: clientLabel(c) }))}
            post={{
              id: post.id,
              clientId: post.clientId,
              platform: post.platform,
              format: post.format,
              caption: post.caption ?? "",
              mediaUrls: post.mediaUrls,
              date: zoned?.date ?? "",
              time: zoned?.time ?? "",
              publishMode: post.publishMode,
            }}
            directUpload={blobEnabled()}
            captionLockedHref={pendingDraft ? `/review?draft=${pendingDraft.id}` : undefined}
          />
        </Card>

        <div className="flex flex-col gap-4">
          <Card title="Publishing">
            <div className="flex flex-col gap-4 text-sm">
              {post.status === "published" ? (
                <div className="flex flex-col gap-1">
                  <p>
                    <Badge tone="ok">Published</Badge> {post.publishedAt && <span className="text-muted">{formatDate(post.publishedAt, true)}</span>}
                  </p>
                  {post.permalink && (
                    <a href={post.permalink} target="_blank" rel="noreferrer" className="break-all text-accent hover:underline">{post.permalink}</a>
                  )}
                </div>
              ) : post.status === "publishing" ? (
                <p className="text-muted">
                  Publishing to Instagram now… If this hasn&apos;t finished within about 15 minutes, the next publishing run marks it failed so you can check
                  Instagram and retry.
                </p>
              ) : post.status === "scheduled" ? (
                <div className="flex flex-col gap-2">
                  <p>Scheduled to auto-publish {post.scheduledFor ? `on ${formatDate(post.scheduledFor, true)} ET` : ""}.</p>
                  <form action={setPostStatusAction}>
                    <input type="hidden" name="id" value={post.id} />
                    <input type="hidden" name="status" value="approved" />
                    <Button type="submit" size="sm">Cancel schedule</Button>
                  </form>
                </div>
              ) : post.publishMode === "auto" && isIg ? (
                <div className="flex flex-col gap-2">
                  <p className="text-muted">Set to auto-publish to Instagram, but not scheduled yet.</p>
                  {canSchedule ? (
                    <form action={schedulePostAction}>
                      <input type="hidden" name="id" value={post.id} />
                      <Button type="submit" variant="primary">Schedule auto-publish</Button>
                    </form>
                  ) : (
                    <p className="text-xs text-muted">To schedule it: {scheduleBlockers.join(", ")}.</p>
                  )}
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <p className="text-muted">
                    {post.platform === "tiktok"
                      ? "Post this from the TikTok app (TikTok keeps API posts from unaudited apps private), then mark it published."
                      : "Post this from the Instagram app, then mark it published."}
                  </p>
                  {post.caption && <CopyButton text={post.caption} label="Copy caption" size="sm" className="self-start" />}
                </div>
              )}

              {post.status !== "publishing" && (
                <form action={markPublishedAction} className="flex flex-col gap-2 border-t border-border pt-4">
                  <input type="hidden" name="id" value={post.id} />
                  <label htmlFor="permalink" className="label">{post.status === "published" ? "Post link" : "Link to the live post (optional)"}</label>
                  <input id="permalink" name="permalink" type="url" defaultValue={post.permalink ?? ""} placeholder={post.platform === "tiktok" ? "https://www.tiktok.com/@…/video/…" : "https://www.instagram.com/p/…"} className="input" />
                  <Button type="submit" variant={post.status === "published" ? "secondary" : "primary"} className="self-start">
                    {post.status === "published" ? "Save link" : "Mark published"}
                  </Button>
                </form>
              )}

              {["idea", "drafted", "approved", "failed"].includes(post.status) && (
                <form action={setPostStatusAction} className="flex flex-wrap items-end gap-2 border-t border-border pt-4">
                  <input type="hidden" name="id" value={post.id} />
                  <div className="min-w-40 flex-1">
                    <label htmlFor="status" className="label">Status</label>
                    <select id="status" name="status" defaultValue={post.status === "failed" ? "approved" : post.status} className="input">
                      <option value="idea">Idea</option>
                      <option value="drafted">Drafted</option>
                      <option value="approved">Ready to post</option>
                    </select>
                  </div>
                  <Button type="submit">Set</Button>
                </form>
              )}
            </div>
          </Card>

          {post.mediaUrls.length > 0 && (
            <Card title={`Media (${post.mediaUrls.length})`}>
              <MediaStrip urls={post.mediaUrls} />
              <p className="mt-2 text-xs text-muted">Tap a photo or video to open it full size and save it.</p>
            </Card>
          )}

          <Card title="Linked">
            <ul className="flex flex-col gap-2 text-sm">
              {drafts.length === 0 && !task && <li className="text-muted">No draft or task linked. Claude links drafts here when it writes the caption.</li>}
              {drafts.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-2">
                  <span className="text-muted">Draft:</span>
                  <Link href={`/review?draft=${d.id}`} className="min-w-0 break-words hover:underline">{d.title}</Link>
                  <StatusBadge status={d.status} />
                  <span className="text-xs text-muted">{relativeTime(d.createdAt)}</span>
                </li>
              ))}
              {task && (
                <li className="flex flex-wrap items-center gap-2">
                  <span className="text-muted">Task:</span>
                  <Link href={`/tasks/${task.id}`} className="min-w-0 break-words hover:underline">{task.title}</Link>
                  <StatusBadge status={task.status} />
                </li>
              )}
            </ul>
          </Card>

          <details className="rounded-xl border border-border bg-surface">
            <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-danger">Delete this post…</summary>
            <form action={deletePostAction} className="flex flex-col gap-2 border-t border-border p-4 text-sm">
              <input type="hidden" name="id" value={post.id} />
              <input type="hidden" name="returnTo" value={`/calendar?tab=posts${zoned ? `&month=${zoned.date.slice(0, 7)}` : ""}`} />
              <p className="text-muted">This removes it from the calendar. It doesn&apos;t delete anything already posted on {post.platform === "tiktok" ? "TikTok" : "Instagram"}.</p>
              <Button type="submit" variant="danger" className="self-start">Delete post</Button>
            </form>
          </details>
        </div>
      </div>
    </div>
  );
}
