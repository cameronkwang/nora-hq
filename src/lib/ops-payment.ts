import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "./db";
import { logActivity } from "./activity";
import { OpsError } from "./ops";
import { looksLikeSecret, secretRefusal } from "./credential-guard";

/**
 * Nora's payment line: how she gets paid, as printed on payment requests ("Zelle: 804-555-0123").
 * One row in app_settings (schema.NORA_PAYMENT_KEY → { line }). Set once in Settings → Nora (or on a deal the
 * first time). People only; never a password — the credential guard refuses anything that looks like one.
 */

const MACHINE = new Set(["claude", "public", "system"]);
export const PAYMENT_LINE_MAX = 200;

const Line = z.preprocess(
  (v) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : v),
  z.string().max(PAYMENT_LINE_MAX, `Keep it under ${PAYMENT_LINE_MAX} characters.`),
);

/** The saved line, or null when it hasn't been set. */
export async function getPaymentLine(): Promise<string | null> {
  const db = await getDb();
  const [row] = await db.select({ value: schema.appSettings.value }).from(schema.appSettings).where(eq(schema.appSettings.key, schema.NORA_PAYMENT_KEY));
  const line = row?.value?.line;
  return typeof line === "string" && line.trim() ? line.trim() : null;
}

/** Saves (or, with empty text, clears) the payment line. Returns what was stored. */
export async function savePaymentLine(input: unknown, actor: string): Promise<string | null> {
  if (MACHINE.has(actor.toLowerCase())) throw new OpsError("Only Nora or Cameron can change how Nora gets paid.");
  const line = Line.parse(input);
  const secrets = looksLikeSecret(line);
  if (secrets.length) throw new OpsError(secretRefusal("the payment line", secrets));
  const db = await getDb();
  const now = new Date();
  const value = { line };
  await db.insert(schema.appSettings).values({ key: schema.NORA_PAYMENT_KEY, value, updatedBy: actor, updatedAt: now })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value, updatedBy: actor, updatedAt: now } });
  // The line itself stays out of the activity log (it can hold a phone number or email).
  await logActivity({ actor, action: "payment_line.saved", entityType: "app_setting", entityId: schema.NORA_PAYMENT_KEY, summary: line ? "Updated how Nora gets paid (used on payment requests)" : "Cleared how Nora gets paid" });
  return line || null;
}
