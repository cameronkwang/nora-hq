/**
 * Pure helpers for saved replies, shared by the server (ops-replies, MCP) and the client (ReplyPicker).
 * No "use client" / no server-only imports.
 */

export const REPLY_CATEGORIES = ["collab", "client", "outreach", "general"] as const;
export type ReplyCategory = (typeof REPLY_CATEGORIES)[number];

export const REPLY_CATEGORY_LABEL: Record<ReplyCategory, string> = {
  collab: "Collabs",
  client: "Clients",
  outreach: "Outreach",
  general: "General",
};

/** The placeholders a saved reply may use. Anything else in braces is left alone. */
export const REPLY_PLACEHOLDERS = ["name", "business", "date", "link"] as const;
export type ReplyContext = Partial<Record<(typeof REPLY_PLACEHOLDERS)[number], string | null | undefined>>;

const PH_RE = /\{(name|business|date|link)\}/g;

/** Fills {name} {business} {date} {link} from context. Unknown/empty values stay as the placeholder so the gap is obvious. */
export function fillReply(body: string, ctx: ReplyContext = {}): string {
  return body.replace(PH_RE, (m, key: keyof ReplyContext) => {
    const v = ctx[key];
    return typeof v === "string" && v.trim() ? v.trim() : m;
  });
}

/** Placeholders still unfilled after fillReply (shown as a hint before sending). */
export function missingPlaceholders(text: string): string[] {
  return [...new Set([...text.matchAll(PH_RE)].map((m) => m[1]))];
}

/** "there" reads better than an empty name in "Hi {name}". */
export function firstName(full: string | null | undefined): string | undefined {
  const s = (full ?? "").trim();
  if (!s) return undefined;
  return s.split(/\s+/)[0];
}
