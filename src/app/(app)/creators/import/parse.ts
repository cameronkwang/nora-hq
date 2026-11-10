/**
 * Pure helpers for the creator CSV import. No server-only imports: the import screen runs these in the
 * browser for the live preview, and lib/ops-creators runs them again on the server before saving.
 */

export const IMPORT_FIELDS = [
  "name",
  "instagramHandle",
  "tiktokHandle",
  "email",
  "city",
  "niche",
  "instagramFollowers",
  "tiktokFollowers",
  "engagementRate",
  "notes",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

export const FIELD_LABEL: Record<ImportField, string> = {
  name: "Name",
  instagramHandle: "Instagram",
  tiktokHandle: "TikTok",
  email: "Email",
  city: "City",
  niche: "Niche",
  instagramFollowers: "IG followers",
  tiktokFollowers: "TikTok followers",
  engagementRate: "Engagement %",
  notes: "Notes",
};

/** One mapped spreadsheet row: raw cell text per field (only mapped fields present). */
export type RawImportRow = Partial<Record<ImportField, string>>;

export const MAX_IMPORT_ROWS = 1000;

/* ───────── Delimited text → cells ───────── */

/**
 * Splits pasted Google Sheets data (tab-separated) or CSV text into rows of cells.
 * Handles quoted cells with commas, tabs, doubled quotes and line breaks. Blank lines are dropped.
 */
export function parseDelimited(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const delim = firstLine.includes("\t") ? "\t" : firstLine.split(";").length > firstLine.split(",").length ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell.trim() === "") { quoted = true; cell = ""; }
    else if (ch === delim) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      rows.push(row); row = [];
    } else cell += ch;
  }
  row.push(cell);
  rows.push(row);
  return rows
    .map((r) => r.map((c) => c.trim().replace(/^'(?=[=+\-@])/, ""))) // undo the export's formula guard
    .filter((r) => r.some((c) => c !== ""));
}

/* ───────── Header auto-detect ───────── */

const EXACT: Record<string, ImportField> = {
  name: "name", creator: "name", creatorname: "name", fullname: "name", displayname: "name",
  instagram: "instagramHandle", ig: "instagramHandle", handle: "instagramHandle", ighandle: "instagramHandle", instagramhandle: "instagramHandle",
  insta: "instagramHandle", username: "instagramHandle", igusername: "instagramHandle",
  tiktok: "tiktokHandle", tt: "tiktokHandle", tiktokhandle: "tiktokHandle", tthandle: "tiktokHandle",
  email: "email", emailaddress: "email", mail: "email",
  city: "city", location: "city", town: "city", area: "city",
  niche: "niche", category: "niche", focus: "niche",
  followers: "instagramFollowers", igfollowers: "instagramFollowers", instagramfollowers: "instagramFollowers",
  tiktokfollowers: "tiktokFollowers", ttfollowers: "tiktokFollowers",
  engagement: "engagementRate", engagementrate: "engagementRate", engagementratepct: "engagementRate", er: "engagementRate", eng: "engagementRate",
  notes: "notes", note: "notes", comments: "notes", creatornotes: "notes",
};

const squash = (header: string) => header.toLowerCase().replace(/[^a-z0-9]/g, "");

function fuzzy(header: string): ImportField | null {
  const h = squash(header);
  if (!h) return null;
  const tiktok = h.includes("tiktok") || h.startsWith("tt");
  if (h.includes("follow")) return tiktok ? "tiktokFollowers" : "instagramFollowers";
  if (h.includes("engag")) return "engagementRate";
  if (h.includes("mail")) return "email";
  if (tiktok) return "tiktokHandle";
  if (h.includes("insta") || h.startsWith("ig")) return "instagramHandle";
  if (h.includes("name")) return "name";
  if (h.includes("city")) return "city";
  if (h.includes("niche")) return "niche";
  return null;
}

/**
 * Best guess per header column; each field is used at most once. Exact header names win over
 * partial matches (so "Creator" beats "Restaurant name" for Name), then the leftmost column wins.
 */
export function guessMapping(headers: string[]): Array<ImportField | ""> {
  const out: Array<ImportField | ""> = headers.map(() => "");
  const used = new Set<ImportField>();
  for (const pass of [(h: string) => EXACT[squash(h)] ?? null, fuzzy]) {
    headers.forEach((h, i) => {
      if (out[i]) return;
      const f = pass(h);
      if (f && !used.has(f)) {
        out[i] = f;
        used.add(f);
      }
    });
  }
  return out;
}

export function applyMapping(rows: string[][], mapping: Array<ImportField | "">): RawImportRow[] {
  return rows.map((cells) => {
    const out: RawImportRow = {};
    mapping.forEach((f, i) => {
      if (f && cells[i] != null && cells[i] !== "") out[f] = cells[i];
    });
    return out;
  });
}

/* ───────── Cell values ───────── */

const BLANK = /^(-+|—|n\/?a|none|null|\?)$/i;

/** "12,300" / "12.5k" / "1.2M" / "12 500" → integer. Empty or "n/a" → null. Unreadable → NaN. */
export function parseFollowerCount(raw: string | null | undefined): number | null {
  const s = (raw ?? "").trim().toLowerCase().replace(/[,\s_]/g, "").replace(/followers?$/, "");
  if (!s || BLANK.test(s)) return null;
  const m = /^(\d+(?:\.\d+)?)([km])?\+?$/.exec(s);
  if (!m) return Number.NaN;
  const mult = m[2] === "m" ? 1_000_000 : m[2] === "k" ? 1_000 : 1;
  return Math.round(Number(m[1]) * mult);
}

/** "3.4%" / "3.4" → 3.4. Empty or "n/a" → null. Unreadable → NaN. */
export function parseEngagement(raw: string | null | undefined): number | null {
  const s = (raw ?? "").trim().replace(/%$/, "").trim();
  if (!s || BLANK.test(s)) return null;
  const n = Number(s.replace(/,/g, "."));
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : Number.NaN;
}

/** Same normalisation lib/ops applies to handles, so lookups match stored values. */
export function normalizeHandle(s: string | null | undefined): string | null {
  const v = s?.trim();
  return v ? v.replace(/^@/, "").replace(/^https?:\/\/(www\.)?(instagram|tiktok)\.com\/@?/i, "").replace(/[/?].*$/, "").toLowerCase() || null : null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type CleanImportRow = {
  name: string;
  instagramHandle: string | null;
  tiktokHandle: string | null;
  email: string | null;
  city?: string;
  niche?: string;
  notes?: string;
  instagramFollowers: number | null;
  tiktokFollowers: number | null;
  engagementRate: number | null;
};

/**
 * Validates one mapped row. Empty cells come back undefined/null so an import never blanks out
 * something we already know about a creator. A missing name falls back to the handle.
 */
export function cleanRow(r: RawImportRow): { row: CleanImportRow } | { error: string } {
  const ig = normalizeHandle(r.instagramHandle);
  const tt = normalizeHandle(r.tiktokHandle);
  const email = r.email?.trim().toLowerCase() || null;
  if (email && !EMAIL.test(email)) return { error: `Email “${r.email}” doesn't look right` };
  if (!ig && !tt && !email) return { error: "Needs an Instagram, TikTok or email" };
  const igF = parseFollowerCount(r.instagramFollowers);
  const ttF = parseFollowerCount(r.tiktokFollowers);
  const er = parseEngagement(r.engagementRate);
  if (Number.isNaN(igF)) return { error: `Can't read IG followers “${r.instagramFollowers}”` };
  if (Number.isNaN(ttF)) return { error: `Can't read TikTok followers “${r.tiktokFollowers}”` };
  if (Number.isNaN(er)) return { error: `Can't read engagement “${r.engagementRate}”` };
  const name = r.name?.trim() || (ig ? `@${ig}` : tt ? `@${tt}` : (email ?? ""));
  const opt = (s: string | undefined) => s?.trim() || undefined;
  return {
    row: {
      name,
      instagramHandle: ig,
      tiktokHandle: tt,
      email,
      city: opt(r.city),
      niche: opt(r.niche),
      notes: opt(r.notes),
      instagramFollowers: igF,
      tiktokFollowers: ttF,
      engagementRate: er,
    },
  };
}
