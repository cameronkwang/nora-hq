import { cx } from "./ui";

/** Server-safe media previews for content posts. */

export function isVideoUrl(url: string) {
  return /\.(mp4|mov|m4v|webm|ogv)(\?|#|$)/i.test(url);
}

export function MediaThumb({ url, size = "md", controls = false }: { url: string; size?: "sm" | "md" | "lg"; controls?: boolean }) {
  const box = size === "sm" ? "size-14" : size === "md" ? "size-24" : "aspect-square w-full max-w-xs";
  return (
    <a href={url} target="_blank" rel="noreferrer" className={cx("block shrink-0 overflow-hidden rounded-lg border border-border bg-surface-2", box)} title="Open full size">
      {isVideoUrl(url) ? (
        <video src={url} muted playsInline preload="metadata" controls={controls} className="size-full object-cover" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" loading="lazy" className="size-full object-cover" />
      )}
    </a>
  );
}

export function MediaStrip({ urls, size = "md" }: { urls: string[]; size?: "sm" | "md" | "lg" }) {
  if (!urls.length) return null;
  return (
    <ul className="flex flex-wrap gap-2">
      {urls.map((u, i) => (
        <li key={`${u}-${i}`}>
          <MediaThumb url={u} size={size} />
        </li>
      ))}
    </ul>
  );
}
