"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { OUTREACH_CHANNELS, OUTREACH_STAGES, type OutreachChannel, type OutreachStage } from "@/lib/schema";
import { updateCreator, upsertCreator, upsertOutreach } from "@/lib/ops";
import { COMP_TYPES, findExistingCreator, findOutreach, normalizeHandle } from "./queries";

export type FormState = { ok?: boolean; error?: string; message?: string; at?: number };

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};
const opt = (fd: FormData, k: string) => str(fd, k).trim() || null;

function errorMessage(e: unknown): string {
  if (e instanceof z.ZodError) {
    return e.issues
      .map((i) => {
        const field = String(i.path[0] ?? "");
        if (field === "email") return "That email doesn't look right.";
        if (field === "name") return "Give the creator a name.";
        return `${field || "input"}: ${i.message}`;
      })
      .join(" ");
  }
  if (e instanceof Error) return e.message;
  return "Something went wrong";
}

/** "12,300" / "12.3k" / "1.2M" → integer. Empty → null. Garbage → NaN (caught by caller). */
function parseCount(raw: string): number | null {
  const s = raw.trim().toLowerCase().replace(/[,\s]/g, "");
  if (!s) return null;
  const m = /^(\d+(?:\.\d+)?)([km])?$/.exec(s);
  if (!m) return Number.NaN;
  const mult = m[2] === "m" ? 1_000_000 : m[2] === "k" ? 1_000 : 1;
  return Math.round(Number(m[1]) * mult);
}

function parseRate(raw: string): number | null {
  const s = raw.trim().replace(/%$/, "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : Number.NaN;
}

/** Reads the shared creator fields. Returns an error string when a number is unreadable. */
function creatorFields(fd: FormData) {
  const instagramFollowers = parseCount(str(fd, "instagramFollowers"));
  const tiktokFollowers = parseCount(str(fd, "tiktokFollowers"));
  const engagementRate = parseRate(str(fd, "engagementRate"));
  if (Number.isNaN(instagramFollowers)) return { error: "Instagram followers should be a number, like 12500 or 12.5k." } as const;
  if (Number.isNaN(tiktokFollowers)) return { error: "TikTok followers should be a number, like 12500 or 12.5k." } as const;
  if (Number.isNaN(engagementRate)) return { error: "Engagement should be a percent, like 3.4." } as const;
  return {
    values: {
      name: str(fd, "name").trim(),
      instagramHandle: opt(fd, "instagramHandle"),
      tiktokHandle: opt(fd, "tiktokHandle"),
      email: opt(fd, "email"),
      city: opt(fd, "city"),
      niche: opt(fd, "niche"),
      instagramFollowers,
      tiktokFollowers,
      engagementRate,
      notes: opt(fd, "notes"),
      source: opt(fd, "source"),
    },
  } as const;
}

const pick = <T extends string>(list: readonly T[], v: string, fallback: T): T => ((list as readonly string[]).includes(v) ? (v as T) : fallback);
const channelOf = (fd: FormData, fallback: OutreachChannel = "instagram_dm") => pick(OUTREACH_CHANNELS, str(fd, "channel"), fallback);
const compOf = (fd: FormData) => pick(COMP_TYPES, str(fd, "compType"), "tbd");
const stageOf = (fd: FormData, fallback: OutreachStage = "sourced") => pick(OUTREACH_STAGES, str(fd, "stage"), fallback);

/** "YYYY-MM-DD" from a date input → ~9-10am Eastern that day. "" → null. */
function followUpDate(raw: string): Date | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T14:00:00Z`) : null;
}

function refresh(creatorId?: string, clientIds: string[] = []) {
  revalidatePath("/creators");
  if (creatorId) revalidatePath(`/creators/${creatorId}`);
  for (const c of clientIds) revalidatePath(`/clients/${c}`);
  revalidatePath("/");
}

/* ───────── Creators ───────── */

export async function createCreatorAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = creatorFields(fd);
  if ("error" in parsed) return { error: parsed.error };
  const v = parsed.values;
  if (!v.name) return { error: "Give the creator a name." };
  if (!v.instagramHandle && !v.tiktokHandle && !v.email) return { error: "Add at least an Instagram handle, TikTok handle or public email." };

  const clientId = opt(fd, "clientId");
  let id: string;
  let merged = false;
  try {
    const existing = await findExistingCreator(normalizeHandle(v.instagramHandle), normalizeHandle(v.tiktokHandle), v.email?.toLowerCase() ?? null);
    merged = !!existing;
    id = await upsertCreator({ ...v, ...(existing ? { id: existing.id } : {}) }, user.email);
    // Don't reset an existing relationship's stage when the creator was already in the roster.
    if (clientId && !(merged && (await findOutreach(clientId, id)))) {
      await upsertOutreach(
        { clientId, creatorId: id, channel: channelOf(fd), compType: compOf(fd), stage: stageOf(fd, "shortlisted") },
        user.email,
      );
    }
  } catch (e) {
    return { error: errorMessage(e) };
  }
  refresh(id, clientId ? [clientId] : []);
  redirect(`/creators/${id}${merged ? "?merged=1" : "?added=1"}`);
}

export async function updateCreatorAction(creatorId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = creatorFields(fd);
  if ("error" in parsed) return { error: parsed.error };
  if (!parsed.values.name) return { error: "Name can't be empty." };
  try {
    await updateCreator(creatorId, parsed.values, user.email);
  } catch (e) {
    return { error: errorMessage(e) };
  }
  refresh(creatorId);
  return { ok: true, message: "Saved.", at: Date.now() };
}

export async function setDoNotContactAction(creatorId: string, fd: FormData): Promise<void> {
  const user = await requireUser();
  const on = str(fd, "doNotContact") === "1";
  await updateCreator(creatorId, { doNotContact: on }, user.email);
  refresh(creatorId);
}

/* ───────── Outreach ───────── */

/** Full save of one (business, creator) relationship from the profile page. */
export async function saveOutreachAction(clientId: string, creatorId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const stage = stageOf(fd);
  const disclosure = str(fd, "disclosureOk");
  try {
    await upsertOutreach(
      {
        clientId,
        creatorId,
        channel: channelOf(fd),
        // Only send the stage when it changed, so saving notes doesn't bump "last activity".
        ...(stage !== str(fd, "currentStage") ? { stage } : {}),
        compType: compOf(fd),
        nextFollowUpAt: followUpDate(str(fd, "nextFollowUpAt")),
        postUrl: opt(fd, "postUrl"),
        disclosureOk: disclosure === "yes" ? true : disclosure === "no" ? false : null,
        notes: opt(fd, "notes"),
      },
      user.email,
    );
  } catch (e) {
    return { error: errorMessage(e) };
  }
  refresh(creatorId, [clientId]);
  return { ok: true, message: "Saved.", at: Date.now() };
}

/** Quick stage move from the pipeline board (plain form, no client state). */
export async function moveStageAction(fd: FormData): Promise<void> {
  const user = await requireUser();
  const clientId = str(fd, "clientId");
  const creatorId = str(fd, "creatorId");
  const back = str(fd, "back");
  const safeBack = back.startsWith("/creators") ? back : "/creators?view=pipeline";
  let error = "";
  try {
    await upsertOutreach({ clientId, creatorId, channel: channelOf(fd), stage: stageOf(fd) }, user.email);
  } catch (e) {
    error = errorMessage(e);
  }
  refresh(creatorId, [clientId]);
  if (error) {
    const u = new URL(safeBack, "http://x");
    u.searchParams.set("error", error);
    redirect(`${u.pathname}${u.search}`);
  }
  redirect(safeBack);
}

export async function addOutreachAction(creatorId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const clientId = opt(fd, "clientId");
  if (!clientId) return { error: "Pick a business." };
  try {
    if (await findOutreach(clientId, creatorId)) return { error: "They're already in outreach for that business." };
    await upsertOutreach(
      { clientId, creatorId, channel: channelOf(fd), compType: compOf(fd), stage: stageOf(fd, "shortlisted") },
      user.email,
    );
  } catch (e) {
    return { error: errorMessage(e) };
  }
  refresh(creatorId, [clientId]);
  return { ok: true, message: "Added.", at: Date.now() };
}
