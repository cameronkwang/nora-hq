"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { OpsError } from "@/lib/ops";
import {
  MANUAL_PAYMENT_METHODS,
  MoneyInputError,
  parseDollars,
  type ImportKind,
  type ImportPreview,
  type ImportResult,
  type InvoiceDone,
  type LastInvoice,
  type ManualPaymentMethod,
} from "@/lib/invoices-types";
import {
  createAndFinalizeInvoice,
  createCustomer,
  createRetainer,
  createRetainerFromContract,
  deleteCustomer,
  deleteDraftInvoice,
  deletePayment,
  deleteRetainer,
  finalizeInvoice,
  getInvoiceLink,
  lastInvoiceForCustomer,
  markReminderSent,
  previewSkynovaImport,
  recordPayment,
  replaceInvoiceLink,
  saveQuickDraft,
  saveSkynovaImport,
  setCustomerArchived,
  setNextInvoiceNumber,
  updateCustomer,
  updateInvoice,
  updateRetainer,
  voidInvoice,
  type InvoicePatchT,
  type QuickInvoiceInputT,
} from "@/lib/ops-invoices";
import type { ActionFormState } from "@/components/client-form";
import type { IntakeLang } from "@/lib/schema";

/**
 * Signed-in invoicing actions (people only; Claude has no path here). Every write goes through lib/ops-invoices with
 * the person's email as the actor, which logs the activity. Ops and validation errors come back as plain words.
 *
 * Speed (docs/invoicing.md "Speed"): Make PDF and Save as draft do NOT call revalidatePath. A revalidation inside a
 * server action makes Next re-render the current page into the same response, which would re-run the creator's
 * context reads inside the Make PDF round trip. Every invoicing page is dynamic (force-dynamic), so the next visit
 * to a list reads fresh data anyway.
 */

export type ActionResult<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };

const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.trim() : "");

async function origin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

function message(e: unknown): string | null {
  if (e instanceof OpsError || e instanceof MoneyInputError) return e.message;
  if (e instanceof z.ZodError) return e.issues[0]?.message ?? "Check the form.";
  return null;
}

/** Runs fn; a known error becomes { ok: false, error } so the form keeps everything and shows it inline. */
async function attempt<T extends object>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, ...(await fn()) };
  } catch (e) {
    const m = message(e);
    if (m) return { ok: false, error: m };
    console.error("[invoices] action failed", e instanceof Error ? e.message : e);
    return { ok: false, error: "Something went wrong. Try again." };
  }
}

function formState(r: ActionResult, ok: string): ActionFormState {
  return r.ok ? { ok: true, message: ok, at: Date.now() } : { error: r.error, at: Date.now() };
}

function refreshInvoice(id: string, customerId?: string | null) {
  revalidatePath("/invoices");
  revalidatePath(`/invoices/${id}`);
  if (customerId) revalidatePath(`/invoices/customers/${customerId}`);
}

/* ───────────────────────── The fast creator ───────────────────────── */

/** "Make PDF": saves and finalizes in one step (number, status sent, link) and returns the done state. */
export async function makePdfAction(input: QuickInvoiceInputT): Promise<ActionResult<{ done: InvoiceDone }>> {
  const user = await requireUser();
  const o = await origin();
  return attempt(async () => ({ done: await createAndFinalizeInvoice(input, user.email, { origin: o }) }));
}

/** "Save as draft": the same form, no number, no link. */
export async function saveDraftAction(input: QuickInvoiceInputT): Promise<ActionResult<{ id: string; customerId: string }>> {
  const user = await requireUser();
  return attempt(async () => {
    const r = await saveQuickDraft(input, user.email);
    return { id: r.id, customerId: r.customerId };
  });
}

/** Editing a finalized invoice from the creator (?edit=): everything but the customer. */
export async function updateInvoiceAction(id: string, patch: InvoicePatchT): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();
  const r = await attempt(async () => {
    const inv = await updateInvoice(id, patch, user.email);
    return { id: inv.id, customerId: inv.customerId };
  });
  if (r.ok) refreshInvoice(r.id, r.customerId);
  return r.ok ? { ok: true, id: r.id } : r;
}

/** "Same as last time": fetched when a customer with past invoices is picked (the tap then applies it at once). */
export async function lastInvoiceAction(customerId: string): Promise<LastInvoice | null> {
  await requireUser();
  try {
    return await lastInvoiceForCustomer(customerId);
  } catch {
    return null;
  }
}

/** "Next invoice number" (the creator's #0000170 and Settings). Never back onto a used number: the op floors it. */
export async function setNextNumberAction(n: number): Promise<ActionResult<{ next: string }>> {
  const user = await requireUser();
  const r = await attempt(async () => ({ next: await setNextInvoiceNumber(n, user.email) }));
  if (r.ok) revalidatePath("/settings");
  return r;
}

/* ───────────────────────── One invoice ───────────────────────── */

/** "Make PDF" on a draft (the invoice page): finalizes it and returns the done state. A second press changes nothing. */
export async function finalizeAction(id: string): Promise<ActionResult<{ done: InvoiceDone }>> {
  const user = await requireUser();
  const o = await origin();
  const r = await attempt(async () => ({ done: (await finalizeInvoice(id, user.email, { origin: o })).done }));
  if (r.ok) refreshInvoice(id, r.done.customerId);
  return r;
}

export async function recordPaymentAction(_prev: ActionFormState, fd: FormData): Promise<ActionFormState> {
  const user = await requireUser();
  const id = str(fd.get("invoiceId"));
  const method = str(fd.get("method"));
  const r = await attempt(async () => {
    const amountCents = parseDollars(str(fd.get("amount")));
    if (amountCents == null) throw new OpsError("Enter the amount received.");
    const m: ManualPaymentMethod = (MANUAL_PAYMENT_METHODS as readonly string[]).includes(method) ? (method as ManualPaymentMethod) : "other";
    const { invoice } = await recordPayment(id, { amountCents, paidOn: str(fd.get("paidOn")), method: m, reference: str(fd.get("reference")) || null, note: str(fd.get("note")) || null }, user.email);
    return { customerId: invoice.customerId };
  });
  if (r.ok) refreshInvoice(id, r.customerId);
  return formState(r, "Payment recorded.");
}

export async function deletePaymentAction(fd: FormData): Promise<void> {
  const user = await requireUser();
  const id = str(fd.get("paymentId"));
  const invoiceId = str(fd.get("invoiceId"));
  const r = await attempt(async () => ({ customerId: (await deletePayment(id, user.email)).customerId }));
  if (!r.ok) redirect(`/invoices/${encodeURIComponent(invoiceId)}?error=${encodeURIComponent(r.error)}`);
  refreshInvoice(invoiceId, r.customerId);
}

export async function voidInvoiceAction(fd: FormData): Promise<void> {
  const user = await requireUser();
  const id = str(fd.get("id"));
  const r = await attempt(async () => ({ customerId: (await voidInvoice(id, user.email, { reason: str(fd.get("reason")) || null })).customerId }));
  if (!r.ok) redirect(`/invoices/${encodeURIComponent(id)}?error=${encodeURIComponent(r.error)}`);
  refreshInvoice(id, r.customerId);
}

export async function deleteDraftAction(fd: FormData): Promise<void> {
  const user = await requireUser();
  const id = str(fd.get("id"));
  const r = await attempt(async () => {
    await deleteDraftInvoice(id, user.email);
    return {};
  });
  if (!r.ok) redirect(`/invoices/${encodeURIComponent(id)}?error=${encodeURIComponent(r.error)}`);
  revalidatePath("/invoices");
  redirect("/invoices?status=draft&deleted=1");
}

/** The customer link to copy (made the first time for an imported invoice). */
export async function invoiceLinkAction(id: string): Promise<ActionResult<{ url: string }>> {
  const user = await requireUser();
  const o = await origin();
  return attempt(async () => {
    const url = await getInvoiceLink(id, user.email, { origin: o });
    if (!url) throw new OpsError("A draft has no link yet. Make the PDF first.");
    return { url };
  });
}

/** "New link": the old one stops working at once. */
export async function replaceLinkAction(id: string): Promise<ActionResult<{ url: string }>> {
  const user = await requireUser();
  const o = await origin();
  const r = await attempt(async () => ({ url: await replaceInvoiceLink(id, user.email, { origin: o }) }));
  if (r.ok) revalidatePath(`/invoices/${id}`);
  return r;
}

/** "I sent it" under the reminder text. */
export async function reminderSentAction(id: string): Promise<ActionResult> {
  const user = await requireUser();
  const r = await attempt(async () => {
    await markReminderSent(id, user.email);
    return {};
  });
  if (r.ok) revalidatePath(`/invoices/${id}`);
  return r;
}

/* ───────────────────────── Customers ───────────────────────── */

const langOf = (v: string): IntakeLang | null => (v === "en" || v === "zh-Hans" || v === "zh-Hant" ? v : null);

function customerFields(fd: FormData) {
  return {
    name: str(fd.get("name")),
    contactName: str(fd.get("contactName")) || null,
    email: str(fd.get("email")) || null,
    phone: str(fd.get("phone")) || null,
    billingAddress: str(fd.get("billingAddress")) || null,
    notes: str(fd.get("notes")) || null,
    lang: langOf(str(fd.get("lang"))),
  };
}

export async function createCustomerAction(_prev: ActionFormState, fd: FormData): Promise<ActionFormState> {
  const user = await requireUser();
  const r = await attempt(async () => ({ id: (await createCustomer(customerFields(fd), user.email)).id }));
  if (!r.ok) return formState(r, "");
  revalidatePath("/invoices/customers");
  redirect(`/invoices/customers/${encodeURIComponent(r.id)}?new=1`);
}

export async function updateCustomerAction(_prev: ActionFormState, fd: FormData): Promise<ActionFormState> {
  const user = await requireUser();
  const id = str(fd.get("id"));
  const r = await attempt(async () => {
    await updateCustomer(id, customerFields(fd), user.email);
    return {};
  });
  if (r.ok) {
    revalidatePath("/invoices/customers");
    revalidatePath(`/invoices/customers/${id}`);
  }
  return formState(r, "Saved.");
}

export async function archiveCustomerAction(fd: FormData): Promise<void> {
  const user = await requireUser();
  const id = str(fd.get("id"));
  const archived = str(fd.get("archived")) === "1";
  const r = await attempt(async () => {
    await setCustomerArchived(id, archived, user.email);
    return {};
  });
  if (!r.ok) redirect(`/invoices/customers/${encodeURIComponent(id)}?error=${encodeURIComponent(r.error)}`);
  revalidatePath("/invoices/customers");
  revalidatePath(`/invoices/customers/${id}`);
}

export async function deleteCustomerAction(fd: FormData): Promise<void> {
  const user = await requireUser();
  const id = str(fd.get("id"));
  const r = await attempt(async () => {
    await deleteCustomer(id, user.email);
    return {};
  });
  if (!r.ok) redirect(`/invoices/customers/${encodeURIComponent(id)}?error=${encodeURIComponent(r.error)}`);
  revalidatePath("/invoices/customers");
  redirect("/invoices/customers");
}

/* ───────────────────────── Retainers ───────────────────────── */

function retainerFields(fd: FormData) {
  const amountCents = parseDollars(str(fd.get("amount")));
  if (amountCents == null) throw new OpsError("Enter the monthly amount.");
  const day = Number(str(fd.get("dayOfMonth")) || "1");
  return {
    description: str(fd.get("description")),
    amountCents,
    dayOfMonth: Number.isFinite(day) ? Math.trunc(day) : 1,
    startMonth: str(fd.get("startMonth")) || null,
  };
}

export async function createRetainerAction(_prev: ActionFormState, fd: FormData): Promise<ActionFormState> {
  const user = await requireUser();
  const customerId = str(fd.get("customerId"));
  const r = await attempt(async () => {
    await createRetainer({ customerId, ...retainerFields(fd) }, user.email);
    return {};
  });
  if (r.ok) revalidatePath(`/invoices/customers/${customerId}`);
  return formState(r, "Monthly invoice set up. Its draft is made on that day each month.");
}

export async function updateRetainerAction(_prev: ActionFormState, fd: FormData): Promise<ActionFormState> {
  const user = await requireUser();
  const id = str(fd.get("id"));
  const customerId = str(fd.get("customerId"));
  const r = await attempt(async () => {
    await updateRetainer(id, retainerFields(fd), user.email);
    return {};
  });
  if (r.ok) revalidatePath(`/invoices/customers/${customerId}`);
  return formState(r, "Saved.");
}

export async function toggleRetainerAction(fd: FormData): Promise<void> {
  const user = await requireUser();
  const id = str(fd.get("id"));
  const customerId = str(fd.get("customerId"));
  const r = await attempt(async () => {
    await updateRetainer(id, { active: str(fd.get("active")) === "1" }, user.email);
    return {};
  });
  if (!r.ok) redirect(`/invoices/customers/${encodeURIComponent(customerId)}?error=${encodeURIComponent(r.error)}`);
  revalidatePath(`/invoices/customers/${customerId}`);
}

export async function deleteRetainerAction(fd: FormData): Promise<void> {
  const user = await requireUser();
  const id = str(fd.get("id"));
  const customerId = str(fd.get("customerId"));
  const r = await attempt(async () => {
    await deleteRetainer(id, user.email);
    return {};
  });
  if (!r.ok) redirect(`/invoices/customers/${encodeURIComponent(customerId)}?error=${encodeURIComponent(r.error)}`);
  revalidatePath(`/invoices/customers/${customerId}`);
}

/** "Set up monthly invoices" on a monthly contract (Past contracts, the customer and deal pages). */
export async function monthlyInvoicesAction(contractId: string): Promise<ActionResult<{ customerId: string; created: boolean }>> {
  const user = await requireUser();
  const r = await attempt(async () => {
    const { retainer, created } = await createRetainerFromContract(contractId, user.email);
    return { customerId: retainer.customerId, created };
  });
  if (r.ok) {
    revalidatePath("/contracts");
    revalidatePath(`/invoices/customers/${r.customerId}`);
  }
  return r;
}

/* ───────────────────────── Import from Skynova ───────────────────────── */

const kindOf = (k: string): ImportKind => (k === "customers" ? "customers" : "invoices");

/** Step 1: what would happen to each pasted row. Writes nothing. */
export async function previewImportAction(text: string, kind: string): Promise<ActionResult<{ preview: ImportPreview }>> {
  await requireUser();
  return attempt(async () => ({ preview: await previewSkynovaImport(text.slice(0, 500_000), kindOf(kind)) }));
}

/** Step 2: saves the same text (re-parsed on the server, never the browser's rows). */
export async function saveImportAction(text: string, kind: string): Promise<ActionResult<{ result: ImportResult }>> {
  const user = await requireUser();
  const r = await attempt(async () => ({ result: await saveSkynovaImport(text.slice(0, 500_000), kindOf(kind), user.email) }));
  if (r.ok) {
    revalidatePath("/invoices");
    revalidatePath("/invoices/customers");
  }
  return r;
}
