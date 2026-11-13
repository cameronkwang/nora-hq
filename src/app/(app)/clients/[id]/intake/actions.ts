"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { createIntakeLink, getIntakeLinkUrl, revokeIntake } from "@/lib/ops-intake";

/** Team-side actions for the client onboarding form (signed-in people only). */

export type IntakeLinkResult = { ok: true; url: string; id: string } | { ok: false; error: string };
export type IntakeRevokeResult = { ok: true } | { ok: false; error: string };

async function origin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

const message = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

function refresh(clientId: string) {
  revalidatePath(`/clients/${clientId}`);
  revalidatePath(`/clients/${clientId}/intake`);
}

export async function createIntakeLinkAction(clientId: string): Promise<IntakeLinkResult> {
  const user = await requireUser();
  try {
    const { id, url } = await createIntakeLink(clientId, user.email, { origin: await origin() });
    refresh(clientId);
    return { ok: true, id, url };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

export async function copyIntakeLinkAction(id: string): Promise<IntakeLinkResult> {
  await requireUser();
  try {
    return { ok: true, id, url: await getIntakeLinkUrl(id, { origin: await origin() }) };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

export async function revokeIntakeAction(id: string, clientId: string): Promise<IntakeRevokeResult> {
  const user = await requireUser();
  try {
    await revokeIntake(id, user.email);
    refresh(clientId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}
