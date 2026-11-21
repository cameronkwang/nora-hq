"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ContractFields } from "@/lib/contract";
import { monthlyInvoicesAction } from "@/app/(app)/invoices/actions";
import { Status, buttonClass, cx } from "./ui";

/**
 * Contract pieces invoicing shows (people only: no Claude tool reads contracts). The contract PDF is rebuilt in the
 * browser from its saved fields; pdf-lib is loaded only when "Download again" is tapped, never on page load.
 */

export async function downloadContractPdf(fields: ContractFields) {
  const [{ contractPdf }, { buildContract, contractFileName }] = await Promise.all([import("@/lib/contract-pdf"), import("@/lib/contract")]);
  const bytes = await contractPdf(buildContract(fields));
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = contractFileName(fields);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function ContractDownloadAgain({ fields, label = "Download again", size = "sm" }: { fields: ContractFields; label?: string; size?: "sm" | "md" }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <>
      <button
        type="button"
        className={buttonClass("ghost", size)}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await downloadContractPdf(fields);
          } catch {
            setError("Couldn't make the contract PDF.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Making PDF…" : label}
      </button>
      {error && <Status tone="danger" small>{error}</Status>}
    </>
  );
}

/** "Set up monthly invoices": a retainer from a monthly contract (one per contract). Then a link to where it lives. */
export function MonthlyInvoicesButton({ contractId, size = "sm", className }: { contractId: string; size?: "sm" | "md"; className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ customerId: string; created: boolean } | null>(null);
  const [error, setError] = useState("");
  if (done)
    return (
      <span className="inv-inline-ok">
        <Status tone="ok" small>{done.created ? "Monthly invoices set up" : "Already set up"}</Status>
        <Link href={`/invoices/customers/${encodeURIComponent(done.customerId)}#retainers`} className="link text-sm">See it</Link>
      </span>
    );
  return (
    <>
      <button
        type="button"
        className={cx(buttonClass("secondary", size), className)}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          const r = await monthlyInvoicesAction(contractId).catch(() => ({ ok: false as const, error: "Couldn't set it up. Try again." }));
          setBusy(false);
          if (!r.ok) return setError(r.error);
          setDone({ customerId: r.customerId, created: r.created });
          router.refresh();
        }}
      >
        {busy ? "Setting up…" : "Set up monthly invoices"}
      </button>
      {error && <Status tone="danger" small className="is-wrap">{error}</Status>}
    </>
  );
}
