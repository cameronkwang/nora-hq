"use client";

import { savePaymentLineAction } from "@/app/(app)/settings/payment-line-actions";
import { ActionForm, SubmitButton } from "./client-form";

/**
 * "How Nora gets paid" — one line printed on every payment request (Zelle, Venmo, PayPal, a check…).
 * Used in Settings → Nora and on a deal the first time she requests payment. Never a password.
 */
export function PaymentLineForm({ line, id = "payment-line" }: { line: string | null; id?: string }) {
  return (
    <ActionForm action={savePaymentLineAction} className="min-w-0">
      <label className="label" htmlFor={id}>How Nora gets paid</label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input id={id} name="line" defaultValue={line ?? ""} maxLength={200} placeholder="Zelle: 804-555-0123" className="input min-w-0 flex-1" autoComplete="off" />
        <SubmitButton variant="secondary" className="shrink-0">Save</SubmitButton>
      </div>
      <p className="mt-1 text-xs text-muted">Printed on payment requests. Zelle, Venmo, PayPal or “check payable to…”. Never a password.</p>
    </ActionForm>
  );
}
