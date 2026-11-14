"use server";

import { z } from "zod";
import { DropLinkError, DropRateLimitError, dropErrorKey, submitDrop } from "@/lib/ops-drop";
import { dropCopy } from "@/lib/drop-copy";
import { intakeCopy, isIntakeLang, type IntakeLangCode } from "@/lib/intake-copy";

/** Public, unauthenticated: the link token is the only key. Everything that reaches the database goes through submitDrop. */

export type DropFormState = {
  at?: number;
  done?: boolean;
  /** The link was turned off while the page was open. */
  gone?: boolean;
  error?: string;
  /** What they typed, handed back so nothing is lost on an error. */
  note?: string;
};

export async function submitDropAction(_prev: DropFormState, fd: FormData): Promise<DropFormState> {
  const at = Date.now();
  const rawLang = fd.get("lang");
  const lang: IntakeLangCode = isIntakeLang(rawLang) ? rawLang : "en";
  const C = intakeCopy(lang);
  const D = dropCopy(lang);
  const rawNote = fd.get("note");
  // Capped so a huge post can't blow up the response (the real limit is enforced in submitDrop).
  const note = typeof rawNote === "string" ? rawNote.slice(0, 6000) : "";
  const up = fd.get("uploads");
  const uploads = typeof up === "string" ? up.slice(0, 20000) : "";

  // Bots: filled the hidden field. Pretend it worked, store nothing.
  const honeypot = fd.get("homepage");
  if (typeof honeypot === "string" && honeypot.trim()) return { at, done: true };

  try {
    await submitDrop(fd.get("token"), { note, uploads }, lang);
    // No revalidatePath: it would re-render this public page. The team pages are dynamic and read fresh data.
    return { at, done: true };
  } catch (e) {
    if (e instanceof z.ZodError) {
      const key = dropErrorKey(e);
      return { at, note, error: key === "needOne" ? D.needOne : key === "secret" ? C.errors.secret : C.errors.tooLong };
    }
    if (e instanceof DropLinkError) return { at, gone: true };
    if (e instanceof DropRateLimitError) return { at, note, error: C.errors.rateLimited };
    console.error("[drop] submit failed", e);
    return { at, note, error: C.errors.generic };
  }
}
