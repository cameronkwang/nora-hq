"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  DEFAULT_DELIVERABLES,
  buildContract,
  contractFileName,
  defaultFields,
  longDate,
  missingFields,
  money,
  type ContractFields,
  type ContractKind,
} from "@/lib/contract";
import { deleteContractAction, saveContractAction } from "@/app/(app)/contracts/actions";
import { Button, Card, cx } from "./ui";

/** A past contract as the page hands it over (dates as strings so it crosses the server/client line). */
export type PastContract = {
  id: string;
  kind: ContractKind;
  clientBusiness: string;
  clientContact: string | null;
  agreementDate: string | null;
  feeCents: number | null;
  createdBy: string;
  createdAt: string;
  fields: ContractFields;
};

async function downloadPdf(fields: ContractFields) {
  const { contractPdf } = await import("@/lib/contract-pdf");
  const bytes = await contractPdf(buildContract(fields));
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = contractFileName(fields);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Nora's own name and email are remembered on this device so she types them once. */
const ME_KEY = "nora-hq:contract-me";

export function ContractBuilder({
  today,
  businesses,
  initial,
  dealId,
  history,
}: {
  today: string;
  businesses: string[];
  initial?: Partial<ContractFields>;
  dealId?: string | null;
  history: PastContract[];
}) {
  const [f, setF] = useState<ContractFields>(() => ({ ...defaultFields(today), ...initial }));
  const [busy, setBusy] = useState(false);
  // Phones: the preview sits below a long form, so it's hidden until she asks for it.
  const [showPreview, setShowPreview] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(ME_KEY) ?? "null") as { name?: string; email?: string } | null;
      if (saved) setF((p) => ({ ...p, creatorName: saved.name || p.creatorName, creatorEmail: saved.email || p.creatorEmail }));
    } catch {
      /* storage unavailable: she just types it */
    }
  }, []);

  const set = <K extends keyof ContractFields>(k: K, v: ContractFields[K]) => setF((p) => ({ ...p, [k]: v }));

  const setKind = (kind: ContractKind) =>
    setF((p) => ({
      ...p,
      kind,
      // Swap the example deliverables only if she hasn't written her own.
      deliverables: p.deliverables === DEFAULT_DELIVERABLES[p.kind] ? DEFAULT_DELIVERABLES[kind] : p.deliverables,
    }));

  const doc = useMemo(() => buildContract(f), [f]);
  const missing = missingFields(f);

  async function download() {
    setBusy(true);
    setError("");
    setNote("");
    try {
      try {
        localStorage.setItem(ME_KEY, JSON.stringify({ name: f.creatorName.trim(), email: f.creatorEmail.trim() }));
      } catch {
        /* ignore */
      }
      // Save first so history matches what she sends; a failed save still lets her download.
      const saved = await saveContractAction({ ...f }, dealId ?? null).catch(() => ({ ok: false as const, error: "Couldn't save it to history." }));
      await downloadPdf(f);
      setNote(saved.ok ? "Downloaded and saved to Past contracts." : `Downloaded. ${saved.error}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't make the PDF.");
    } finally {
      setBusy(false);
    }
  }

  /** "Start from this": load a past contract into the form with today's date. */
  function startFrom(c: PastContract) {
    setF({ ...defaultFields(today), ...c.fields, agreementDate: today });
    setNote(`Loaded ${c.clientBusiness}. Change what's different, then download.`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const collab = f.kind === "collab";

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
      <div className="grid content-start gap-4">
        <Card title="Type">
          <div role="radiogroup" aria-label="Contract type" className="grid grid-cols-2 gap-2">
            {(
              [
                ["collab", "One-time collab", "A visit + reel"],
                ["monthly", "Monthly services", "Ongoing social media"],
              ] as const
            ).map(([k, label, hint]) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={f.kind === k}
                onClick={() => setKind(k)}
                className={cx(
                  "rounded-lg border px-3 py-2 text-left text-sm",
                  f.kind === k ? "border-accent bg-accent-soft text-accent" : "border-border hover:bg-surface-2",
                )}
              >
                <span className="block font-semibold">{label}</span>
                <span className="block text-xs text-muted">{hint}</span>
              </button>
            ))}
          </div>
        </Card>

        <Card title="Client">
          <div className="grid gap-3">
            <Field label="Business name">
              <input className="input" list="contract-businesses" value={f.clientBusiness} onChange={(e) => set("clientBusiness", e.target.value)} placeholder="Pizzeria Delores" />
              <datalist id="contract-businesses">
                {businesses.map((b) => (
                  <option key={b} value={b} />
                ))}
              </datalist>
            </Field>
            <Field label="Contact name">
              <input className="input" value={f.clientContact} onChange={(e) => set("clientContact", e.target.value)} placeholder="Who signs for them" />
            </Field>
            <Field label="Contact email" optional>
              <input className="input" type="email" value={f.clientEmail} onChange={(e) => set("clientEmail", e.target.value)} />
            </Field>
          </div>
        </Card>

        <Card title="The work">
          <div className="grid gap-3">
            <Field label="What you'll deliver" hint="One per line.">
              <textarea className="input" rows={4} value={f.deliverables} onChange={(e) => set("deliverables", e.target.value)} />
            </Field>
            {collab ? (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Visit date" optional>
                  <input className="input" type="date" value={f.visitDate} onChange={(e) => set("visitDate", e.target.value)} />
                </Field>
                <Field label="Post by" optional hint="Default: within 14 days">
                  <input className="input" type="date" value={f.postBy} onChange={(e) => set("postBy", e.target.value)} />
                </Field>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Start date">
                  <input className="input" type="date" value={f.startDate} onChange={(e) => set("startDate", e.target.value)} />
                </Field>
                <Field label="Minimum months">
                  <input className="input" inputMode="numeric" value={f.termMonths} onChange={(e) => set("termMonths", e.target.value)} />
                </Field>
              </div>
            )}
          </div>
        </Card>

        <Card title="Cost">
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label={collab ? "Fee ($)" : "Monthly fee ($)"} hint={collab ? "Leave empty for a free (gifted) collab" : undefined}>
                <input className="input" inputMode="decimal" value={f.fee} onChange={(e) => set("fee", e.target.value)} placeholder="0" />
              </Field>
              <Field label="Pay within (days)">
                <input className="input" inputMode="numeric" value={f.paymentDays} onChange={(e) => set("paymentDays", e.target.value)} />
              </Field>
            </div>
            {collab && (
              <Field label="Deposit (%)" hint="Due on signing; 0 for none">
                <input className="input" inputMode="numeric" value={f.depositPercent} onChange={(e) => set("depositPercent", e.target.value)} />
              </Field>
            )}
          </div>
        </Card>

        <details className="rounded-xl border border-border bg-surface">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold">
            More terms
            <span aria-hidden className="text-muted">▾</span>
          </summary>
          <div className="grid gap-3 border-t border-border p-4">
            <div className="grid grid-cols-2 gap-3">
              {collab && (
                <Field label="Client can repost for (months)">
                  <input className="input" inputMode="numeric" value={f.usageMonths} onChange={(e) => set("usageMonths", e.target.value)} />
                </Field>
              )}
              <Field label="Rounds of fact fixes">
                <input className="input" inputMode="numeric" value={f.revisions} onChange={(e) => set("revisions", e.target.value)} />
              </Field>
              {collab ? (
                <Field label="Reschedule notice (hours)">
                  <input className="input" inputMode="numeric" value={f.noticeHours} onChange={(e) => set("noticeHours", e.target.value)} />
                </Field>
              ) : (
                <Field label="Cancellation notice (days)">
                  <input className="input" inputMode="numeric" value={f.noticeDays} onChange={(e) => set("noticeDays", e.target.value)} />
                </Field>
              )}
              <Field label="State law">
                <input className="input" value={f.state} onChange={(e) => set("state", e.target.value)} />
              </Field>
            </div>
            <Field label="Agreement date">
              <input className="input" type="date" value={f.agreementDate} onChange={(e) => set("agreementDate", e.target.value)} />
            </Field>
            <Field label="Extra terms" optional hint="One per line, added at the end.">
              <textarea className="input" rows={3} value={f.extraTerms} onChange={(e) => set("extraTerms", e.target.value)} />
            </Field>
          </div>
        </details>

        <Card title="You">
          <div className="grid gap-3">
            <Field label="Your name" hint="Your legal name. Starts as Nora Chen; a change is remembered on this device.">
              <input className="input" value={f.creatorName} onChange={(e) => set("creatorName", e.target.value)} autoComplete="name" />
            </Field>
            <Field label="Your email" optional>
              <input className="input" type="email" value={f.creatorEmail} onChange={(e) => set("creatorEmail", e.target.value)} autoComplete="email" />
            </Field>
          </div>
        </Card>

        <div className="grid gap-2">
          {/* Desktop: the button sits under the form. Phones use the sticky bar below. */}
          {/* Wrapped: Button's own inline-flex would beat a "hidden" class on it. */}
          <div className="hidden lg:grid">
            <Button variant="primary" onClick={download} disabled={busy}>
              {busy ? "Making PDF…" : "Download PDF"}
            </Button>
          </div>
          {missing.length > 0 && <p className="text-xs text-warn">Still blank: {missing.join(", ")}. The PDF shows [brackets] there.</p>}
          {error && <p role="alert" className="text-xs text-danger">{error}</p>}
          {note && <p role="status" className="text-xs text-ok">{note}</p>}
          <p className="text-xs text-muted">This is a plain-English starting template, not legal advice. Have a lawyer look it over once before you use it widely.</p>
        </div>
      </div>

      {/* Live preview: the same text the PDF uses. */}
      <section
        id="contract-preview"
        aria-label="Preview"
        className={cx(
          "scroll-mt-4 rounded-xl border border-border bg-surface p-5 md:p-8 lg:sticky lg:top-6 lg:block lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto",
          !showPreview && "hidden",
        )}
      >
        <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-muted">Preview</p>
        <h2 className="text-xl font-semibold">{doc.title}</h2>
        <p className="mt-2 text-sm">{doc.intro}</p>
        <ol className="mt-5 grid gap-4">
          {doc.sections.map((s, i) => (
            <li key={s.heading}>
              <h3 className="text-sm font-semibold">
                {i + 1}. {s.heading}
              </h3>
              <div className="mt-1 grid gap-1.5 text-sm">
                {s.paragraphs.map((p, j) =>
                  p.startsWith("•  ") ? (
                    <p key={j} className="pl-4 -indent-3">• {p.slice(3)}</p>
                  ) : (
                    <p key={j} className={p.startsWith("[") && p.endsWith("]") ? "text-warn" : undefined}>{p}</p>
                  ),
                )}
              </div>
            </li>
          ))}
        </ol>
        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          {doc.signers.map((s) => (
            <div key={s.role}>
              <div className="h-8 border-b border-text/60" />
              <p className="mt-1 text-xs text-muted">{[s.role, s.name, s.business].filter(Boolean).join(" · ")} · Date</p>
            </div>
          ))}
        </div>
      </section>

      <PastContracts history={history} onStartFrom={startFrom} />

      {/* Phones: Preview + Download stay in reach above the bottom tab bar while she scrolls the form. */}
      <div className="fixed inset-x-0 bottom-[var(--tabbar-h)] z-20 border-t border-border bg-surface/95 px-4 py-2 backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-md gap-2">
          <Button
            type="button"
            onClick={() => {
              const next = !showPreview;
              setShowPreview(next);
              if (next) requestAnimationFrame(() => document.getElementById("contract-preview")?.scrollIntoView({ behavior: "smooth" }));
            }}
            className="flex-1"
            aria-expanded={showPreview}
            aria-controls="contract-preview"
          >
            {showPreview ? "Hide preview" : "Preview"}
          </Button>
          <Button variant="primary" onClick={download} disabled={busy} className="flex-[2]">
            {busy ? "Making PDF…" : "Download PDF"}
          </Button>
        </div>
      </div>
      {/* Room so the sticky bar never covers the last field or the preview. */}
      <div aria-hidden className="h-16 lg:hidden" />
    </div>
  );
}

function Field({ label, hint, optional, children }: { label: string; hint?: string; optional?: boolean; children: ReactNode }) {
  return (
    <label className="grid content-start gap-1 text-sm">
      <span className="font-medium">
        {label}
        {optional && <span className="font-normal text-muted"> (optional)</span>}
      </span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

function PastContracts({ history, onStartFrom }: { history: PastContract[]; onStartFrom: (c: PastContract) => void }) {
  const [busyId, setBusyId] = useState("");
  return (
    <section id="past-contracts" aria-label="Past contracts" className="scroll-mt-4 lg:col-span-2">
      <Card title={<>Past contracts{history.length > 0 && <span className="font-normal text-muted"> · {history.length}</span>}</>} padded={false}>
        {history.length === 0 ? (
          <p className="p-4 text-sm text-muted">Contracts you download show up here, so you can see who got what and download them again.</p>
        ) : (
          <ul className="divide-y divide-border">
            {history.map((c) => (
              <li key={c.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate font-medium">{c.clientBusiness}</p>
                  <p className="text-xs text-muted">
                    {[
                      c.kind === "monthly" ? "Monthly" : "Collab",
                      c.feeCents ? `${money(c.feeCents / 100)}${c.kind === "monthly" ? "/mo" : ""}` : "No fee",
                      longDate(c.agreementDate ?? "") || null,
                      c.createdBy,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    size="sm"
                    disabled={busyId === c.id}
                    onClick={async () => {
                      setBusyId(c.id);
                      try {
                        await downloadPdf(c.fields);
                      } finally {
                        setBusyId("");
                      }
                    }}
                  >
                    Download
                  </Button>
                  <Button size="sm" onClick={() => onStartFrom(c)}>
                    Start from this
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Remove ${c.clientBusiness} from history`}
                    onClick={async () => {
                      if (!window.confirm(`Remove the ${c.clientBusiness} contract from history? The PDF you sent isn't affected.`)) return;
                      await deleteContractAction(c.id);
                    }}
                  >
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}
