"use client";

import Link from "next/link";
import { useState, useTransition, type FormEvent } from "react";
import { createPostAction, updatePostAction, type PostFormState } from "@/app/(app)/calendar/actions";
import { UploadPicker, checkFile, uploadFiles } from "./upload-picker";
import { countHashtags, textLimit } from "./draft-checks";
import { Status, buttonClass, cx } from "./ui";

type Opt = { id: string; label: string };

const FORMATS: Record<"instagram" | "tiktok", Array<{ id: string; label: string }>> = {
  instagram: [
    { id: "feed", label: "Feed post" },
    { id: "reel", label: "Reel" },
    { id: "carousel", label: "Carousel" },
    { id: "story", label: "Story" },
  ],
  tiktok: [
    { id: "video", label: "Video" },
    { id: "carousel", label: "Photo carousel" },
  ],
};

export type PostFormValues = {
  id: string;
  clientId: string;
  platform: "instagram" | "tiktok";
  format: string;
  caption: string;
  mediaUrls: string[];
  date: string;
  time: string;
  publishMode: "auto" | "manual";
};

function isVideo(url: string) {
  return /\.(mp4|mov|m4v|webm|ogv)(\?|#|$)/i.test(url);
}

/** Create or edit a calendar post. Files upload from the browser first, then the action saves. */
export function CalendarPostForm({
  clients,
  post,
  defaults,
  directUpload,
  captionLockedHref,
}: {
  clients: Opt[];
  post?: PostFormValues;
  defaults?: { clientId?: string; platform?: "instagram" | "tiktok"; date?: string };
  directUpload: boolean;
  /** When a draft for this post is waiting in the review queue, the caption is edited there. */
  captionLockedHref?: string;
}) {
  const editing = !!post;
  const [platform, setPlatform] = useState<"instagram" | "tiktok">(post?.platform ?? defaults?.platform ?? "instagram");
  const [format, setFormat] = useState(post?.format ?? (platform === "tiktok" ? "video" : "feed"));
  const [mode, setMode] = useState<"auto" | "manual">(post?.publishMode ?? "manual");
  const [caption, setCaption] = useState(post?.caption ?? "");
  const [kept, setKept] = useState<string[]>(post?.mediaUrls ?? []);
  const [files, setFiles] = useState<File[]>([]);
  const [pasted, setPasted] = useState("");
  const [date, setDate] = useState(post?.date ?? defaults?.date ?? "");
  const [time, setTime] = useState(post?.time ?? (defaults?.date ? "12:00" : ""));
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "uploading" | "saving">("idle");
  const [progress, setProgress] = useState(0);
  const [busy, start] = useTransition();

  const lim = textLimit(platform === "instagram" ? "instagram_post" : "tiktok_post");
  const tags = countHashtags(caption);
  const over = !!lim && caption.length > lim.max;
  const tooManyTags = platform === "instagram" && tags > 30;
  const effectiveMode = platform === "tiktok" ? "manual" : mode;
  const hasMedia = kept.length + files.length + (pasted.trim() ? 1 : 0) > 0;
  const canAutoSchedule = effectiveMode === "auto" && !!date && hasMedia;

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    const bad = files.map(checkFile).find(Boolean);
    if (bad) return setError(bad);
    if (over) return setError(`The caption is over ${lim!.max.toLocaleString("en-US")} characters.`);
    if (tooManyTags) return setError("Instagram allows 30 hashtags at most.");
    start(async () => {
      try {
        setProgress(0);
        setPhase("uploading");
        const uploaded = files.length ? await uploadFiles(files, directUpload, setProgress) : [];
        fd.delete("files");
        fd.set("uploaded", JSON.stringify(uploaded));
        setPhase("saving");
        const res: PostFormState = editing ? await updatePostAction(undefined, fd) : await createPostAction(undefined, fd);
        if (res?.error) {
          setError(res.error);
          // Keep the already-uploaded files so a retry doesn't upload them twice.
          if (uploaded.length) {
            setKept((k) => [...k, ...uploaded.map((u) => u.url)]);
            setFiles([]);
          }
        }
      } catch (err) {
        if (err && typeof err === "object" && "digest" in err && String((err as { digest: unknown }).digest).startsWith("NEXT_REDIRECT")) return;
        setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
      } finally {
        setPhase("idle");
      }
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      {post && <input type="hidden" name="id" value={post.id} />}
      {kept.map((u) => (
        <input key={u} type="hidden" name="keepMedia" value={u} />
      ))}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="pf-client" className="label">Business</label>
          {editing ? (
            <p className="font-medium">{clients.find((c) => c.id === post!.clientId)?.label ?? "Archived business"}</p>
          ) : (
            <select id="pf-client" name="clientId" required defaultValue={defaults?.clientId ?? ""} className="input" disabled={busy}>
              <option value="" disabled>Choose a business…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          )}
        </div>
        <fieldset>
          <legend className="label">Platform</legend>
          {editing ? (
            <p className="font-medium">{platform === "instagram" ? "Instagram" : "TikTok"}</p>
          ) : (
            // Two choices drawn as chips: the chosen one is ink.
            <div className="post-platform chips">
              {(["instagram", "tiktok"] as const).map((p) => (
                <label key={p} className={cx("chip", platform === p && "is-on")}>
                  <input
                    type="radio"
                    name="platform"
                    value={p}
                    checked={platform === p}
                    disabled={busy}
                    onChange={() => {
                      setPlatform(p);
                      setFormat(p === "tiktok" ? "video" : "feed");
                    }}
                    className="sr-only"
                  />
                  <span>{p === "instagram" ? "Instagram" : "TikTok"}</span>
                </label>
              ))}
            </div>
          )}
        </fieldset>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="pf-format" className="label">Format</label>
          <select id="pf-format" name="format" value={format} onChange={(e) => setFormat(e.target.value)} className="input" disabled={busy}>
            {FORMATS[platform].map((f) => (
              <option key={f.id} value={f.id}>{f.label}</option>
            ))}
            {!FORMATS[platform].some((f) => f.id === format) && <option value={format}>{format}</option>}
          </select>
        </div>
        <div>
          <label htmlFor="pf-date" className="label">Date</label>
          <input id="pf-date" type="date" name="date" value={date} onChange={(e) => setDate(e.target.value)} className="input" disabled={busy} />
        </div>
        <div>
          <label htmlFor="pf-time" className="label">Time (Eastern)</label>
          <input id="pf-time" type="time" name="time" value={time} onChange={(e) => setTime(e.target.value)} className="input" disabled={busy || !date} />
        </div>
      </div>
      {!date && <p className="hint -mt-4">Leave the date empty to keep it as an unscheduled idea.</p>}

      <div>
        <label htmlFor="pf-caption" className="label">Caption</label>
        {captionLockedHref ? (
          <div className="border-l-2 border-border pl-3">
            <p className="whitespace-pre-wrap break-words">{caption || <span className="text-muted">(No caption yet)</span>}</p>
            <p className="meta mt-2">
              A draft of this caption is waiting for review. <Link href={captionLockedHref} className="link">Edit or approve it in the review queue</Link>.
            </p>
          </div>
        ) : (
          <>
            <textarea id="pf-caption" name="caption" rows={6} value={caption} onChange={(e) => setCaption(e.target.value)} className="input" readOnly={busy} placeholder="Write the caption, or leave it for Claude to draft." />
            <div className="meta mt-1.5 flex flex-wrap justify-between gap-2">
              <span className={cx(tooManyTags && "font-semibold text-danger")}>{platform === "instagram" ? `${tags} hashtag${tags === 1 ? "" : "s"} (30 max)` : `${tags} hashtag${tags === 1 ? "" : "s"}`}</span>
              <span className={cx("tabular-nums", over && "font-semibold text-danger")}>
                {caption.length.toLocaleString("en-US")} / {lim!.max.toLocaleString("en-US")}
              </span>
            </div>
          </>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <span className="label">Photos &amp; videos</span>
        {kept.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {kept.map((u) => (
              <li key={u} className="relative w-24">
                <div className="size-24 overflow-hidden rounded-lg border border-border bg-surface-2">
                  {isVideo(u) ? (
                    <video src={u} muted playsInline preload="metadata" className="size-full object-cover" />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={u} alt="" className="size-full object-cover" />
                  )}
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setKept((k) => k.filter((x) => x !== u))}
                  aria-label="Remove this media"
                  className="tap-target absolute -right-1.5 -top-1.5 flex size-6 items-center justify-center rounded-full border border-border-strong bg-surface text-xs hover:border-text"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
        <UploadPicker files={files} onChange={setFiles} disabled={busy} label="Upload photos or videos" />
        <div>
          <label htmlFor="pf-urls" className="label">…or paste links (one per line)</label>
          <textarea id="pf-urls" name="mediaUrls" rows={2} value={pasted} onChange={(e) => setPasted(e.target.value)} className="input min-h-0" placeholder="https://…" readOnly={busy} />
        </div>
        {platform === "instagram" && <p className="meta">Instagram needs public links (JPEG photos, MP4/MOV videos) to auto-publish.</p>}
      </div>

      <fieldset className="flex flex-col">
        <legend className="label">How it gets posted</legend>
        <label className="post-choice">
          <input type="radio" name="publishMode" value="manual" checked={effectiveMode === "manual"} onChange={() => setMode("manual")} disabled={busy} className="check" />
          <span>
            <span className="font-medium">Post it myself from the app</span>
            <span className="meta block">You get a reminder on the calendar; mark it published when it&apos;s live.</span>
          </span>
        </label>
        <label className={cx("post-choice", platform === "tiktok" && "is-off")}>
          <input type="radio" name="publishMode" value="auto" checked={effectiveMode === "auto"} onChange={() => setMode("auto")} disabled={busy || platform === "tiktok"} className="check" />
          <span>
            <span className="font-medium">Auto-publish to Instagram</span>
            <span className="meta block">
              {platform === "tiktok"
                ? "Not available for TikTok: its API keeps posts from unaudited apps private, so TikTok posts go up from the TikTok app."
                : "Publishes at the date and time above once it's scheduled. Needs the business's Instagram connected."}
            </span>
          </span>
        </label>
      </fieldset>

      {!editing && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="pf-status" className="label">Status</label>
            <select id="pf-status" name="status" defaultValue="idea" className="input" disabled={busy}>
              <option value="idea">Idea</option>
              <option value="drafted">Drafted</option>
              <option value="approved">Ready to post (approved)</option>
            </select>
          </div>
          {effectiveMode === "auto" && (
            <label className={cx("flex min-h-11 flex-wrap items-center gap-x-3 self-end", !canAutoSchedule && "opacity-60")}>
              <input type="checkbox" name="scheduleNow" value="1" disabled={busy || !canAutoSchedule} className="check" />
              Schedule auto-publish now
              {!canAutoSchedule && <span className="meta">(needs date + media)</span>}
            </label>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="notice">
          <Status tone="danger" className="whitespace-normal">{error}</Status>
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy} className={cx(buttonClass("secondary"), "w-full sm:w-auto")}>
          {phase === "uploading" && files.length
            ? `Uploading ${Math.min(progress + 1, files.length)} of ${files.length}…`
            : busy
              ? "Saving…"
              : editing
                ? "Save changes"
                : "Add to calendar"}
        </button>
        {!editing && <Link href="/calendar?tab=posts" className={buttonClass("ghost")}>Cancel</Link>}
      </div>
    </form>
  );
}
