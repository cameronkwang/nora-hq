"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  CollabRateLimitError, checkCollabFormToken, collabFieldErrors, collabIpHash, submitCollabRequest,
} from "@/lib/ops-collab";
import { COLLAB_COPY, FIELDS, type CollabField } from "@/lib/collab-copy";

/** Public, unauthenticated. Everything that reaches the database goes through submitCollabRequest. */

export type CollabFormState = {
  at?: number;
  done?: { name: string; email: string };
  error?: string;
  errors?: Partial<Record<CollabField, string>>;
  values?: Record<string, string | string[]>;
};

const MULTI = new Set(["interests", "deliverables"]);
const KNOWN = new Set<string>([...Object.keys(FIELDS), "ackDisclosure", "ackHonest"]);

/** Form fields → plain object (known keys only, capped so a huge post can't blow up the response). */
function readForm(fd: FormData): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const k of KNOWN) {
    if (MULTI.has(k)) out[k] = fd.getAll(k).filter((v): v is string => typeof v === "string").slice(0, 20).map((v) => v.slice(0, 100));
    else {
      const v = fd.get(k);
      if (typeof v === "string") out[k] = v.slice(0, 5000);
    }
  }
  return out;
}

async function clientIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip")?.trim() || null;
}

export async function submitCollabAction(_prev: CollabFormState, fd: FormData): Promise<CollabFormState> {
  const at = Date.now();
  const values = readForm(fd);

  // Bots: filled the hidden field, or posted faster than a person could. Pretend it worked, store nothing.
  const honeypot = fd.get("homepage");
  if ((typeof honeypot === "string" && honeypot.trim()) || !checkCollabFormToken(fd.get("t"))) {
    return { at, done: { name: String(values.contactName ?? "").trim().slice(0, 60) || "there", email: String(values.email ?? "").trim().slice(0, 200) } };
  }

  try {
    const ipHash = collabIpHash(await clientIp());
    await submitCollabRequest(values, { ipHash });
  } catch (e) {
    if (e instanceof z.ZodError) return { at, values, errors: collabFieldErrors(e), error: COLLAB_COPY.fixErrors };
    if (e instanceof CollabRateLimitError) return { at, values, error: COLLAB_COPY.rateLimited };
    console.error("[collab] submit failed", e);
    return { at, values, error: COLLAB_COPY.genericError };
  }
  revalidatePath("/collabs");
  const name = String(values.contactName ?? "").trim().split(/\s+/)[0] || "there";
  return { at, done: { name: name.slice(0, 60), email: String(values.email ?? "").trim().toLowerCase().slice(0, 200) } };
}
