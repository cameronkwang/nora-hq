import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "./db";
import { newId } from "./ids";
import { logActivity } from "./activity";
import { allowedUsers } from "./auth";
import { OpsError, createTask } from "./ops";
import { askTaskTitle, createRoutedAsk } from "./ops-asks";
import type { Attachment } from "./schema";

/**
 * One-tap capture: personal tokens for the iPhone Shortcut (POST /api/asks/capture) and the shared
 * "drop something in" logic used by both that endpoint and the composer at the top of Home.
 * Same conventions as lib/ops: zod-validated input, `actor` is a user email, one activity entry per call.
 *
 * Tokens: "nhq_" + 32 random bytes (base64url). Only the sha256 hash is stored; the raw token is
 * returned once, at creation.
 */

/* ───────────────────────── Tokens ───────────────────────── */

const TOKEN_PREFIX = "nhq_";
const TOKEN_RE = /^nhq_[A-Za-z0-9_-]{43}$/;

const hashToken = (raw: string) => createHash("sha256").update(raw, "utf8").digest("hex");

function userFor(email: string) {
  return allowedUsers().find((u) => u.email === email.trim().toLowerCase()) ?? null;
}

const TokenInput = z.object({
  userEmail: z.string().trim().toLowerCase().min(3),
  label: z.string().trim().min(1, "Give it a name").max(60, "Keep the name under 60 characters"),
});

export type CaptureTokenSummary = { id: string; label: string; lastUsedAt: Date | null; createdAt: Date };

/** Creates a capture token for `userEmail`. Returns the raw token — show it once, it can't be recovered. */
export async function createCaptureToken(userEmail: string, label: string, actor: string) {
  const v = TokenInput.parse({ userEmail, label });
  if (!userFor(v.userEmail)) throw new OpsError("Tokens are only for people who can sign in.");
  if (actor !== v.userEmail && actor !== "system") throw new OpsError("You can only make tokens for yourself.");
  const token = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  const db = await getDb();
  const id = newId("cap_");
  await db.insert(schema.captureTokens).values({ id, userEmail: v.userEmail, label: v.label, tokenHash: hashToken(token) });
  await logActivity({ actor, action: "capture_token.created", entityType: "capture_token", entityId: id, summary: `Added a quick-capture key: ${v.label}` });
  return { id, label: v.label, token };
}

/** Active (not revoked) tokens for one person, newest first. Never includes the hash. */
export async function listCaptureTokens(userEmail: string): Promise<CaptureTokenSummary[]> {
  const db = await getDb();
  return db
    .select({ id: schema.captureTokens.id, label: schema.captureTokens.label, lastUsedAt: schema.captureTokens.lastUsedAt, createdAt: schema.captureTokens.createdAt })
    .from(schema.captureTokens)
    .where(and(eq(schema.captureTokens.userEmail, userEmail.trim().toLowerCase()), isNull(schema.captureTokens.revokedAt)))
    .orderBy(desc(schema.captureTokens.createdAt));
}

/** Revokes one of the actor's own tokens. Idempotent. */
export async function revokeCaptureToken(id: string, actor: string) {
  const db = await getDb();
  const [row] = await db.select().from(schema.captureTokens).where(eq(schema.captureTokens.id, id));
  if (!row || row.userEmail !== actor.trim().toLowerCase()) throw new OpsError("Key not found.");
  if (row.revokedAt) return;
  await db.update(schema.captureTokens).set({ revokedAt: new Date() }).where(eq(schema.captureTokens.id, id));
  await logActivity({ actor, action: "capture_token.revoked", entityType: "capture_token", entityId: id, summary: `Turned off quick-capture key: ${row.label}` });
}

/**
 * Checks a raw bearer token. Returns the token id and its person, or null. Lookup is by sha256 hash
 * (so timing doesn't leak the token) and the hash is re-compared in constant time. Updates lastUsedAt.
 */
export async function verifyCaptureToken(raw: string | null | undefined) {
  if (!raw || !TOKEN_RE.test(raw)) return null;
  const hash = hashToken(raw);
  const db = await getDb();
  const [row] = await db.select().from(schema.captureTokens)
    .where(and(eq(schema.captureTokens.tokenHash, hash), isNull(schema.captureTokens.revokedAt)));
  if (!row) return null;
  const a = Buffer.from(row.tokenHash, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const user = userFor(row.userEmail); // removed from APP_USERS → token stops working
  if (!user) return null;
  await db.update(schema.captureTokens).set({ lastUsedAt: new Date() }).where(eq(schema.captureTokens.id, row.id));
  return { tokenId: row.id, label: row.label, user };
}

/** Naive rate limit: how many asks/tasks this person created in the last minute. */
export async function recentCaptureCount(actor: string, windowMs = 60_000) {
  const db = await getDb();
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.activity).where(and(
    eq(schema.activity.actor, actor),
    inArray(schema.activity.action, ["ask.created", "task.created"]),
    gt(schema.activity.createdAt, new Date(Date.now() - windowMs)),
  ));
  return r?.n ?? 0;
}

/* ───────────────────────── Capture ───────────────────────── */

export const CAPTURE_ROUTES = ["auto", "claude", "cameron", "nora", "idea", "fyi", "adhoc"] as const;
export type CaptureRoute = (typeof CAPTURE_ROUTES)[number];

const ROUTE_ALIASES: Record<string, CaptureRoute> = {
  "": "auto", auto: "auto", claudedecides: "auto", decide: "auto", anyone: "auto",
  claude: "claude", cameron: "cameron", nora: "nora",
  idea: "idea", justanidea: "idea", ideas: "idea",
  fyi: "fyi", note: "fyi",
  adhoc: "adhoc", adhoctask: "adhoc", task: "adhoc",
};

/** Accepts route keys and the menu labels people see ("Claude decides", "Ad hoc task", "Just an idea"). */
export function parseCaptureRoute(v: unknown): CaptureRoute | null {
  if (v == null) return "auto";
  if (typeof v !== "string") return null;
  return ROUTE_ALIASES[v.toLowerCase().replace(/[^a-z]/g, "")] ?? null;
}

const ROUTE_FIELDS: Record<Exclude<CaptureRoute, "adhoc">, { kind: schema.AskKind; forWho: schema.AskFor }> = {
  auto: { kind: "auto", forWho: "auto" },
  claude: { kind: "request", forWho: "claude" },
  cameron: { kind: "request", forWho: "cameron" },
  nora: { kind: "request", forWho: "nora" },
  idea: { kind: "idea", forWho: "anyone" },
  fyi: { kind: "update", forWho: "anyone" },
};

/** "cameron" | "nora" for the actor, if they're one of the two. */
function personOf(actor: string): "cameron" | "nora" | null {
  const n = userFor(actor)?.name.toLowerCase();
  return n === "cameron" || n === "nora" ? n : null;
}

/** The other person (who an ad-hoc task goes to by default). */
export function otherPerson(actor: string): "cameron" | "nora" {
  return personOf(actor) === "cameron" ? "nora" : "cameron";
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Finds a business by id, name, "name location" or a loose match ("poke bros", "Yummy Red Bowl Richmond").
 * Returns null when nothing matches well or the match is ambiguous.
 */
export async function matchClient(query: string | null | undefined) {
  const q = (query ?? "").trim();
  if (!q) return null;
  const db = await getDb();
  const rows = await db.select({ id: schema.clients.id, name: schema.clients.name, location: schema.clients.location, brand: schema.clients.brand })
    .from(schema.clients).where(eq(schema.clients.archived, false));
  const byId = rows.find((c) => c.id === q);
  if (byId) return byId;
  const nq = norm(q);
  if (!nq) return null;
  const qWords = new Set(nq.split(" "));
  let best: { c: (typeof rows)[number]; score: number } | null = null;
  let tie = false;
  for (const c of rows) {
    const name = norm(c.name);
    const full = norm(`${c.name} ${c.location ?? ""}`);
    const words = new Set(full.split(" ").concat(norm(c.brand ?? "").split(" ")).filter(Boolean));
    let score = 0;
    if (nq === full) score = 100;
    else if (nq === name) score = 90;
    else if (full.includes(nq) || nq.includes(full)) score = 70;
    else if (name.includes(nq) || nq.includes(name)) score = 60;
    else {
      const hits = [...qWords].filter((w) => w.length > 1 && words.has(w)).length;
      score = hits ? Math.round((hits / qWords.size) * 50) : 0;
    }
    if (score === 0) continue;
    if (!best || score > best.score) {
      best = { c, score };
      tie = false;
    } else if (score === best.score) tie = true;
  }
  // Same name, several locations, and no location given → ambiguous; let Claude sort it.
  if (!best || best.score < 25 || tie) return null;
  return best.c;
}

export const CaptureInput = z.object({
  text: z.string().max(8000).nullish(),
  url: z.string().max(2000).nullish(),
  route: z.string().max(40).nullish(),
  client: z.string().max(200).nullish(),
  attachments: z.array(z.object({ url: z.string(), name: z.string(), contentType: z.string().optional() })).max(20).default([]),
});

/** Text + link → one ask body (the link on its own line unless it's already in the text). */
export function captureBody(text: string | null | undefined, url: string | null | undefined, files: number) {
  const t = (text ?? "").trim();
  const u = (url ?? "").trim();
  const parts = [t];
  if (u && !t.includes(u)) parts.push(u);
  const body = parts.filter(Boolean).join("\n\n");
  if (body) return body;
  return files ? (files === 1 ? "Sent a photo" : `Sent ${files} photos`) : "";
}

export type CaptureResult = { kind: "ask" | "task"; id: string; route: CaptureRoute; message: string; clientName: string | null };

/**
 * Drops something in, from the Home composer or the iPhone Shortcut.
 *  - any ask route → createRoutedAsk (Claude decides / Claude / Cameron / Nora / Idea / FYI)
 *  - "adhoc" → an ad-hoc task (no deliverable) for the other person
 * Returns a short, human confirmation ("Sent to Claude ✓").
 */
export async function captureAsk(input: z.input<typeof CaptureInput>, actor: string): Promise<CaptureResult> {
  const v = CaptureInput.parse(input);
  const route = parseCaptureRoute(v.route ?? "auto");
  if (!route) throw new OpsError(`Unknown route "${v.route}". Use auto, claude, cameron, nora, idea, fyi or adhoc.`);
  const client = await matchClient(v.client);
  let body = captureBody(v.text, v.url, v.attachments.length);
  if (!body) throw new OpsError("Nothing to send — add a few words, a link or a photo.");
  // Keep an unmatched business name in the text so whoever picks it up still sees it.
  if (v.client?.trim() && !client) body += `\n\nBusiness: ${v.client.trim()}`;
  const where = client ? ` (${client.name}${client.location ? ` · ${client.location}` : ""})` : "";

  if (route === "adhoc") {
    const who = otherPerson(actor);
    const title = askTaskTitle(body);
    const links = v.attachments.map((a) => `${a.name}: ${a.url}`).join("\n");
    const details = [body.trim() !== title ? body.trim() : "", links].filter(Boolean).join("\n\n") || null;
    const id = await createTask({ title, details, clientId: client?.id ?? null, assignee: who }, actor);
    return { kind: "task", id, route, message: `Task added for ${cap(who)} ✓${where}`, clientName: client?.name ?? null };
  }

  const { id } = await createRoutedAsk({ body, clientId: client?.id ?? null, attachments: v.attachments as Attachment[] }, ROUTE_FIELDS[route], actor);
  const msg: Record<Exclude<CaptureRoute, "adhoc">, string> = {
    auto: "Sent ✓ Claude will sort it",
    claude: "Sent to Claude ✓",
    cameron: "Sent to Cameron ✓",
    nora: "Sent to Nora ✓",
    idea: "Saved to Ideas ✓",
    fyi: "Noted ✓",
  };
  return { kind: "ask", id, route, message: msg[route] + where, clientName: client?.name ?? null };
}
