import type { Attachment } from "@/lib/schema";
import { cx } from "./ui";

const isImage = (a: Attachment) => a.contentType?.startsWith("image/") || /\.(png|jpe?g|gif|webp|heic|avif)$/i.test(a.url);
const isVideo = (a: Attachment) => a.contentType?.startsWith("video/") || /\.(mp4|mov|webm|m4v)$/i.test(a.url);

/** Thumbnails for ask attachments. size="sm" for lists, "lg" for the detail page (videos play inline). */
export function AskAttachments({ items, size = "sm" }: { items: Attachment[]; size?: "sm" | "lg" }) {
  if (!items.length) return null;
  const box = size === "sm" ? "size-16" : "aspect-square w-full";
  return (
    <ul className={cx("flex flex-wrap gap-2", size === "lg" && "grid grid-cols-2 sm:grid-cols-3")}>
      {items.map((a, i) => (
        <li key={`${a.url}-${i}`} className={size === "sm" ? "" : "min-w-0"}>
          {size === "lg" && isVideo(a) ? (
            <video src={a.url} controls playsInline preload="metadata" className={cx(box, "ask-thumb object-cover")} />
          ) : (
            <a
              href={a.url}
              target="_blank"
              rel="noreferrer"
              title={a.name}
              className={cx(box, "ask-thumb relative hover:opacity-90")}
            >
              {isImage(a) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.url} alt={a.name} loading="lazy" className="size-full object-cover" />
              ) : isVideo(a) ? (
                <>
                  <video src={`${a.url}#t=0.1`} muted playsInline preload="metadata" className="size-full object-cover" />
                  <span className="tag is-bare absolute bottom-1 left-1 border-0 bg-surface text-text">Video</span>
                </>
              ) : (
                <span className="meta flex size-full items-center justify-center break-all p-1 text-center leading-tight">
                  <span className="line-clamp-3">{a.name}</span>
                </span>
              )}
            </a>
          )}
          {size === "lg" && <p className="meta mt-1 truncate">{a.name}</p>}
        </li>
      ))}
    </ul>
  );
}
