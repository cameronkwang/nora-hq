"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { OpsError } from "@/lib/ops";
import { MoneyInputError, isPayWay, type PayWay, type SavedItem } from "@/lib/invoices-types";
import { saveInvoiceSettings, saveSavedItems, type SavedItemInputT } from "@/lib/ops-invoices";
import type { ActionFormState } from "@/components/client-form";

/**
 * Settings → Invoices and payments (people only; Claude never reads or changes these). The op merges what it is
 * given into the stored row, refuses passwords and card or bank numbers in every text field, and logs that the
 * settings changed, never their values. Stripe keys are never here: only STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET in
 * the environment.
 *
 * Her own bank account (ownBankAccount / ownBankRouting) is the one account number the app keeps: the op checks it,
 * stores it encrypted and answers with fixed words. Nothing here logs, echoes or returns what was typed: an error is
 * the op's own message or a generic one, never the cause.
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
        ownBankLabel: str(fd.get("ownBankLabel")),
        // Empty (or the boxes not shown): keep what is saved. Replacing means typing both again.
        ownBankAccount: str(fd.get("ownBankAccount")) || undefined,
        ownBankRouting: str(fd.get("ownBankRouting")) || undefined,
        // Tick boxes: sent only when she changed one on the page (the card then adds payDefaultsSet); otherwise the
        // stored ticks stay. A way that isn't ready is a disabled box, which a form does not send: an untouched save
        // made before her Zelle number is in must not store "check only" in place of the built-in Zelle and check.
        payDefaults: fd.get("payDefaultsSet") ? fd.getAll("payDefaults").filter((v): v is PayWay => isPayWay(v)) : undefined,
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
    // Never the error's own text: it could quote the query, and the form carries her bank account.
    console.error("[settings] saving the invoice settings failed", e instanceof Error ? e.name : "error");
    return { error: "Couldn't save. Nothing changed. Try again.", at: Date.now() };
  }
  refresh();
  return { ok: true, message: "Saved. New invoices use this.", at: Date.now() };
}

/** "Remove" under Bank transfer (ACH): the saved account is deleted and the way is unticked for new invoices. */
export async function removeBankDetailsAction(): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  try {
    await saveInvoiceSettings({ ownBankRemove: true }, user.email);
    refresh();
    return { ok: true };
  } catch (e) {
    const m = message(e);
    if (m) return { ok: false, error: m };
    console.error("[settings] removing the bank details failed");
    return { ok: false, error: "Couldn't remove it. Try again." };
  }
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
