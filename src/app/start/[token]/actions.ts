"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { collabIpHash } from "@/lib/ops-collab";
import { IntakeLinkError, IntakeRateLimitError, intakeFieldErrors, submitIntake } from "@/lib/ops-intake";
import { CHOICE_FIELDS, TEXT_FIELDS, intakeCopy, isIntakeLang, type IntakeField, type IntakeLangCode } from "@/lib/intake-copy";

/** Public, unauthenticated: the link token is the only key. Everything that reaches the database goes through submitIntake. */

export type IntakeFormState = {
  at?: number;
  done?: { name: string };
  /** The link stopped working while the form was open (revoked, expired, or already sent from another phone). */
  gone?: "expired" | "submitted";
  error?: string;
  errors?: Partial<Record<IntakeField, string>>;
  values?: Record<string, string | string[]>;
};

/** Form fields → plain object (known keys only, capped so a huge post can't blow up the response). */
function readForm(fd: FormData): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const k of Object.keys(TEXT_FIELDS)) {
    const v = fd.get(k);
    if (typeof v === "string") out[k] = v.slice(0, 6000);
  }
  for (const [k, spec] of Object.entries(CHOICE_FIELDS)) {
    if (spec.multi) out[k] = fd.getAll(k).filter((v): v is string => typeof v === "string").slice(0, 20).map((v) => v.slice(0, 60));
    else {
      const v = fd.get(k);
      if (typeof v === "string") out[k] = v.slice(0, 60);
    }
  }
  const up = fd.get("uploads");
  if (typeof up === "string") out.uploads = up.slice(0, 20000);
  return out;
}

async function clientIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip")?.trim() || null;
}

const firstName = (v: unknown) => String(v ?? "").trim().split(/\s+/)[0]?.slice(0, 60) || "";

export async function submitIntakeAction(_prev: IntakeFormState, fd: FormData): Promise<IntakeFormState> {
  const at = Date.now();
  const rawLang = fd.get("lang");
  const lang: IntakeLangCode = isIntakeLang(rawLang) ? rawLang : "en";
  const C = intakeCopy(lang);
  const values = readForm(fd);
  const token = fd.get("token");

  // Bots: filled the hidden field. Pretend it worked, store nothing.
  const honeypot = fd.get("homepage");
  if (typeof honeypot === "string" && honeypot.trim()) return { at, done: { name: firstName(values.contactName) } };
  if (typeof token !== "string") return { at, gone: "expired" };

  try {
    const res = await submitIntake(token, values, lang, { ipHash: collabIpHash(await clientIp()) });
    // No revalidatePath here: it would re-render this public page, which then shows "already sent" instead of
    // the thank-you screen. The team pages are dynamic (signed-in) and read fresh data on their next visit.
    return { at, done: { name: res.name } };
  } catch (e) {
    if (e instanceof z.ZodError) {
      const keys = intakeFieldErrors(e);
      const errors: Partial<Record<IntakeField, string>> = {};
      for (const [field, key] of Object.entries(keys)) if (key) errors[field as IntakeField] = C.errors[key];
      return { at, values, errors, error: C.errors.fix };
    }
    if (e instanceof IntakeLinkError) return { at, gone: e.reason === "submitted" ? "submitted" : "expired" };
    if (e instanceof IntakeRateLimitError) return { at, values, error: C.errors.rateLimited };
    console.error("[intake] submit failed", e);
    return { at, values, error: C.errors.generic };
  }
}
