"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { deleteContract, saveContract } from "@/lib/ops-contracts";

/**
 * Called right before the PDF downloads, so history always matches what was sent. With invoiceId (the contract was
 * made from an invoice, /contracts?invoice=<id>) the saved contract links back to that invoice.
 */
export async function saveContractAction(
  fields: Record<string, string>,
  dealId: string | null,
  invoiceId: string | null = null,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const user = await requireUser();
  try {
    const id = await saveContract({ fields, dealId, invoiceId }, user.name);
    revalidatePath("/contracts");
    if (invoiceId) revalidatePath(`/invoices/${invoiceId}`);
    return { ok: true, id };
  } catch {
    return { ok: false, error: "Couldn't save it to history." };
  }
}

export async function deleteContractAction(id: string): Promise<void> {
  const user = await requireUser();
  await deleteContract(id, user.name);
  revalidatePath("/contracts");
}
