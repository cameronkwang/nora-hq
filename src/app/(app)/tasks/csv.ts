import type { Assignee, Client, Platform } from "@/lib/schema";
import { ASSIGNEES } from "@/lib/schema";

/** CSV helpers for /tasks/export and /tasks/import. Pure functions, no I/O. */

/** RFC 4180 parser: quoted fields, "" escapes, CRLF/LF, a leading BOM. Blank lines are skipped. */
export function parseCsv(text: string): string[][] {
  const s = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

/** RFC 4180 quoting, plus a guard so spreadsheet apps don't execute cells starting with = + - @. */
export function csvCell(v: unknown): string {
  if (v == null) return "";
  let s = String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const IMPORT_HEADERS = ["title", "business", "due", "assignee", "platform", "details"] as const;
export const MAX_IMPORT_ROWS = 300;
export const MAX_IMPORT_BYTES = 512 * 1024;

const HEADER_ALIASES: Record<string, (typeof IMPORT_HEADERS)[number]> = {
  title: "title", task: "title", name: "title",
  business: "business", client: "business", restaurant: "business",
  due: "due", due_date: "due", duedate: "due", date: "due",
  assignee: "assignee", who: "assignee", assigned_to: "assignee", owner: "assignee",
  platform: "platform", channel: "platform",
  details: "details", notes: "details", note: "details", description: "details",
};

const PLATFORM_ALIASES: Record<string, Platform> = {
  instagram: "instagram", ig: "instagram", insta: "instagram",
  tiktok: "tiktok", tt: "tiktok", "tik tok": "tiktok",
  google: "google", "google reviews": "google", gbp: "google",
  email: "email", "e-mail": "email",
  other: "other",
};

export type ImportRow = {
  line: number; // 1-based line in the file (header is line 1)
  title: string;
  clientId: string | null;
  business: string; // what we matched to, for the preview
  dueDate: string | null;
  assignee: Assignee;
  platform: Platform | null;
  details: string | null;
  errors: string[];
};

export type ImportPreview = { rows: ImportRow[]; fileError: string | null; ignoredHeaders: string[] };

const norm = (s: string) => s.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/** Business by id, "Name · Location", "Name - Location", name (if unique) or location (if unique). */
function matchBusiness(raw: string, clients: Pick<Client, "id" | "name" | "location">[]): { client?: (typeof clients)[number]; error?: string } {
  const q = norm(raw);
  if (!q) return {};
  const byId = clients.find((c) => c.id.toLowerCase() === raw.trim().toLowerCase());
  if (byId) return { client: byId };
  const full = clients.filter((c) => norm(`${c.name} ${c.location ?? ""}`) === q);
  if (full.length === 1) return { client: full[0] };
  const byName = clients.filter((c) => norm(c.name) === q);
  if (byName.length === 1) return { client: byName[0] };
  if (byName.length > 1) return { error: `“${raw}” matches ${byName.length} locations — add the location` };
  const byLoc = clients.filter((c) => c.location && norm(c.location) === q);
  if (byLoc.length === 1) return { client: byLoc[0] };
  return { error: `No business called “${raw}”` };
}

/** "2026-11-30", "11/30/2026", "11/30/26" → "2026-11-30". */
function parseDue(raw: string): string | null | undefined {
  const s = raw.trim();
  if (!s) return null;
  let y: number, m: number, d: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s);
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (us) [m, d, y] = [Number(us[1]), Number(us[2]), Number(us[3].length === 2 ? `20${us[3]}` : us[3])];
  else return undefined;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return undefined;
  return dt.toISOString().slice(0, 10);
}

export function buildImportPreview(text: string, clients: Pick<Client, "id" | "name" | "location">[]): ImportPreview {
  if (text.length > MAX_IMPORT_BYTES) return { rows: [], fileError: "That file is too big (max 512 KB).", ignoredHeaders: [] };
  const table = parseCsv(text);
  if (table.length === 0) return { rows: [], fileError: "Nothing to import — the CSV is empty.", ignoredHeaders: [] };

  const header = table[0].map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, "_"));
  const col: Partial<Record<(typeof IMPORT_HEADERS)[number], number>> = {};
  const ignoredHeaders: string[] = [];
  header.forEach((h, i) => {
    const k = HEADER_ALIASES[h];
    if (k && col[k] === undefined) col[k] = i;
    else if (h) ignoredHeaders.push(table[0][i].trim());
  });
  if (col.title === undefined) {
    return { rows: [], fileError: "The first row must be headers, including a “title” column.", ignoredHeaders };
  }
  const body = table.slice(1);
  if (body.length === 0) return { rows: [], fileError: "There are headers but no rows.", ignoredHeaders };
  if (body.length > MAX_IMPORT_ROWS) return { rows: [], fileError: `Too many rows (${body.length}). Import at most ${MAX_IMPORT_ROWS} at a time.`, ignoredHeaders };

  // Undo csvCell's formula guard ("'=…") so an exported file round-trips.
  const get = (r: string[], k: (typeof IMPORT_HEADERS)[number]) =>
    col[k] === undefined ? "" : (r[col[k]!] ?? "").trim().replace(/^'(?=[=+\-@])/, "");
  const rows = body.map((r, i): ImportRow => {
    const errors: string[] = [];
    const title = get(r, "title");
    if (!title) errors.push("Title is missing");
    else if (title.length > 300) errors.push("Title is too long (300 characters max)");

    const biz = get(r, "business");
    const match = matchBusiness(biz, clients);
    if (match.error) errors.push(match.error);

    const dueRaw = get(r, "due");
    const due = parseDue(dueRaw);
    if (due === undefined) errors.push(`Due date “${dueRaw}” isn’t a date (use YYYY-MM-DD)`);

    const whoRaw = get(r, "assignee").toLowerCase();
    let assignee: Assignee = "unassigned";
    if (whoRaw && whoRaw !== "-" && whoRaw !== "none") {
      if ((ASSIGNEES as readonly string[]).includes(whoRaw)) assignee = whoRaw as Assignee;
      else errors.push(`Assignee “${get(r, "assignee")}” should be Nora, Cameron, Claude or blank`);
    }

    const platRaw = get(r, "platform").toLowerCase();
    let platform: Platform | null = null;
    if (platRaw) {
      platform = PLATFORM_ALIASES[platRaw] ?? null;
      if (!platform) errors.push(`Platform “${get(r, "platform")}” should be Instagram, TikTok, Google, Email or Other`);
    }

    const details = get(r, "details");
    return {
      line: i + 2,
      title,
      clientId: match.client?.id ?? null,
      business: match.client ? (match.client.location ? `${match.client.name} · ${match.client.location}` : match.client.name) : "",
      dueDate: due ?? null,
      assignee,
      platform,
      details: details || null,
      errors,
    };
  });
  return { rows, fileError: null, ignoredHeaders };
}
