"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { OpsError } from "@/lib/ops";
import { MoneyInputError, type SavedItem } from "@/lib/invoices-types";
import { saveInvoiceSettings, saveSavedItems, type SavedItemInputT } from "@/lib/ops-invoices";
import type { ActionFormState } from "@/components/client-form";

/**
 * Settings → Invoices and payments (people only; Claude never reads or changes these). The op merges what it is
 * given into the stored row, refuses passwords and card or bank numbers, and logs that the settings changed, never
 * their values. Stripe keys are never here: only STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET in the environment.
 */

const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.trim() : "");

function message(e: unknown): string | null {
  if (e instanceof OpsError || e instanceof MoneyInputError) return e.message;
  if (e instanceof z.ZodError) return e.issues[0]?.message ?? "Check the form.";
  return null;
}

function refresh() {
  revalidatePath("/settings");
  revalidatePath("/invoices/new");
}

export async function saveInvoiceSettingsAction(_prev: ActionFormState, fd: FormData): Promise<ActionFormState> {
  const user = await requireUser();
  const days = Number(str(fd.get("termsDays")) || "0");
  try {
    await saveInvoiceSettings(
      {
        fromName: str(fd.get("fromName")),
        fromAddress: str(fd.get("fromAddress")),
        fromEmail: str(fd.get("fromEmail")),
        fromPhone: str(fd.get("fromPhone")),
        zelle: str(fd.get("zelle")),
        zelleName: str(fd.get("zelleName")),
        checkPayee: str(fd.get("checkPayee")),
        checkAddress: str(fd.get("checkAddress")),
        venmo: str(fd.get("venmo")),
        paypal: str(fd.get("paypal")),
        // Switches: an unticked box sends nothing, so read them by name (the form always renders both).
        achEnabled: fd.get("achEnabled") === "on",
        cardEnabled: fd.get("cardEnabled") === "on",
        termsDays: Number.isInteger(days) ? days : 0,
        footer: str(fd.get("footer")),
      },
      user.email,
    );
  } catch (e) {
    const m = message(e);
    if (m) return { error: m, at: Date.now() };
    throw e;
  }
  refresh();
  return { ok: true, message: "Saved. New invoices use this.", at: Date.now() };
}

/** The creator's one-tap lines, replaced as one list (order kept). */
export async function saveSavedItemsAction(items: SavedItemInputT[]): Promise<{ ok: true; items: SavedItem[] } | { ok: false; error: string }> {
  const user = await requireUser();
  try {
    const saved = await saveSavedItems(items, user.email);
    refresh();
    return { ok: true, items: saved };
  } catch (e) {
    const m = message(e);
    if (m) return { ok: false, error: m };
    console.error("[settings] saved lines failed", e instanceof Error ? e.message : e);
    return { ok: false, error: "Couldn't save the lines. Try again." };
  }
}
