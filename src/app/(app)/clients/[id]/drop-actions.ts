"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { createDropLink, getDropLinkUrl, revokeDropLink } from "@/lib/ops-drop";

/** Team-side actions for a business's owner drop link (signed-in people only). */

export type DropLinkResult = { ok: true; url: string } | { ok: false; error: string };
export type DropRevokeResult = { ok: true } | { ok: false; error: string };

async function origin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

const message = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

/** Makes the business's drop link, or (replace) a new one that turns the old one off. */
export async function createDropLinkAction(clientId: string, replace = false): Promise<DropLinkResult> {
  const user = await requireUser();
  try {
    const { url } = await createDropLink(clientId, user.email, { origin: await origin(), replace });
    revalidatePath(`/clients/${clientId}`);
    return { ok: true, url };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

/** The working link again, for "Copy link & message". */
export async function copyDropLinkAction(clientId: string): Promise<DropLinkResult> {
  await requireUser();
  try {
    const url = await getDropLinkUrl(clientId, { origin: await origin() });
    return url ? { ok: true, url } : { ok: false, error: "There's no working link. Make a new one." };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

export async function revokeDropLinkAction(clientId: string): Promise<DropRevokeResult> {
  const user = await requireUser();
  try {
    await revokeDropLink(clientId, user.email);
    revalidatePath(`/clients/${clientId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}
