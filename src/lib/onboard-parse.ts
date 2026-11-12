/**
 * "Business name or link" — one field on the New client screen that also takes a pasted link.
 * Pure and dependency-free: the form runs it as you type, the server action runs it again (works without JS).
 */

export type ParsedBusinessInput =
  | { kind: "name"; name: string }
  | { kind: "instagram"; handle: string }
  | { kind: "tiktok"; handle: string }
  | { kind: "maps"; url: string }
  | { kind: "website"; url: string };

const IG_RESERVED = new Set(["p", "reel", "reels", "stories", "explore", "accounts", "tv", "direct"]);
const cleanHandle = (h: string) => h.replace(/^@+/, "").replace(/[/?#].*$/, "").trim().toLowerCase();
const HANDLE_RE = /^[a-z0-9._]{1,30}$/;
const decode = (v: string) => {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
};

export function parseBusinessInput(raw: string): ParsedBusinessInput {
  const s = raw.trim();
  if (!s) return { kind: "name", name: "" };

  // "@handle" on its own → Instagram (the usual case for restaurants).
  if (/^@[A-Za-z0-9._]{1,30}$/.test(s)) return { kind: "instagram", handle: cleanHandle(s) };

  const looksLikeUrl = /^https?:\/\//i.test(s) || /^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(\/\S*)?$/i.test(s);
  if (!looksLikeUrl || /\s/.test(s)) return { kind: "name", name: s };

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return { kind: "name", name: s };
  }
  const host = url.hostname.toLowerCase().replace(/^(www\.|m\.)/, "");
  const first = url.pathname.split("/").filter(Boolean)[0] ?? "";

  if (host === "instagram.com" || host === "instagr.am") {
    const h = cleanHandle(decode(first));
    if (h && HANDLE_RE.test(h) && !IG_RESERVED.has(h)) return { kind: "instagram", handle: h };
    return { kind: "website", url: url.toString() };
  }
  if (host === "tiktok.com" || host.endsWith(".tiktok.com")) {
    if (first.startsWith("@")) {
      const h = cleanHandle(decode(first));
      if (h && HANDLE_RE.test(h)) return { kind: "tiktok", handle: h };
    }
    return { kind: "website", url: url.toString() };
  }
  if (
    host === "maps.app.goo.gl" ||
    (host === "goo.gl" && url.pathname.startsWith("/maps")) ||
    host === "maps.google.com" ||
    (/^google\.[a-z.]+$/.test(host) && url.pathname.startsWith("/maps")) ||
    host === "g.page"
  ) {
    return { kind: "maps", url: url.toString() };
  }
  // A bare domain keeps its tidy form ("pokebros.com"); full URLs stay as pasted.
  return { kind: "website", url: /^https?:\/\//i.test(s) ? url.toString().replace(/\/$/, "") : s.replace(/\/$/, "") };
}

export const PARSED_LABEL: Record<Exclude<ParsedBusinessInput["kind"], "name">, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  maps: "Google Maps",
  website: "Website",
};

/** Short human text for a parsed link ("@pokebros", "pokebros.com", "Google Maps pin"). */
export function parsedText(p: ParsedBusinessInput): string {
  switch (p.kind) {
    case "instagram":
    case "tiktok":
      return `@${p.handle}`;
    case "maps":
      return "Pin saved to notes";
    case "website":
      return p.url.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");
    default:
      return p.name;
  }
}
