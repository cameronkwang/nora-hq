"use client";

import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { submitCollabAction, type CollabFormState } from "@/app/collab/actions";
import {
  BUDGETS, BUSINESS_TYPES, COLLAB_COPY as C, COMPENSATION, DELIVERABLES, FIELDS, FIELD_STEP, HEARD_FROM, INTERESTS, PAID_COMPENSATION, ROLES, USAGE,
  type CollabField, type Option,
} from "@/lib/collab-copy";
import { buttonClass, cx } from "./ui";

/**
 * The public "Collab with Nora" form. Three steps on one route; with JavaScript off it renders as one long
 * form (the page's <noscript> style un-hides every step) and still submits to the same server action.
 * Server-side zod is the source of truth; the browser only checks the visible step before moving on.
 */

const STEPS = C.steps.length;

export function CollabForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState<CollabFormState, FormData>(submitCollabAction, {});
  const [step, setStep] = useState(0);
  const [local, setLocal] = useState<Partial<Record<CollabField, string>>>({});
  const v = state.values ?? {};
  const [comp, setComp] = useState(typeof v.compensation === "string" ? v.compensation : "");
  const formRef = useRef<HTMLFormElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const stepRefs = useRef<Array<HTMLElement | null>>([]);
  const errors = { ...state.errors, ...local };

  // JS is running: we validate per step ourselves (hidden steps would otherwise block native validation).
  useEffect(() => {
    if (formRef.current) formRef.current.noValidate = true;
  }, [state.at]);

  // Server came back with errors: go to the first step that has one.
  useEffect(() => {
    if (!state.at || state.done) return;
    const keys = Object.keys(state.errors ?? {}) as CollabField[];
    if (keys.length) setStep(Math.min(...keys.map((k) => FIELD_STEP[k] ?? 0)));
    if (typeof state.values?.compensation === "string") setComp(state.values.compensation);
    topRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [state.at, state.done, state.errors, state.values]);

  if (state.done) return <Thanks name={state.done.name} email={state.done.email} />;

  const go = (n: number) => {
    setStep(n);
    requestAnimationFrame(() => {
      topRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
      stepRefs.current[n]?.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
    });
  };

  const checkStep = (n: number): boolean => {
    const root = stepRefs.current[n];
    if (!root) return true;
    for (const el of root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input, select, textarea")) {
      if (!el.checkValidity()) {
        el.reportValidity();
        el.focus();
        return false;
      }
    }
    if (n === 1 && !root.querySelector('input[name="interests"]:checked')) {
      setLocal((l) => ({ ...l, interests: "Pick at least one — whatever's closest." }));
      root.querySelector<HTMLElement>('input[name="interests"]')?.focus();
      return false;
    }
    return true;
  };

  const val = (k: string) => (typeof v[k] === "string" ? (v[k] as string) : "");
  const arr = (k: string) => (Array.isArray(v[k]) ? (v[k] as string[]) : []);
  const paid = (PAID_COMPENSATION as readonly string[]).includes(comp);
  const p = { val, arr, errors };

  return (
    <div ref={topRef} className="scroll-mt-4">
      <Progress step={step} />

      {state.error && (
        <p role="alert" className="mb-5 rounded-xl bg-danger-soft px-4 py-3 text-[15px] text-danger">
          {state.error}
        </p>
      )}

      <form
        key={state.at ?? 0}
        ref={formRef}
        action={formAction}
        className="collab-form"
        onSubmit={(e) => {
          // Enter on an earlier step moves forward instead of sending.
          if (step < STEPS - 1) {
            e.preventDefault();
            if (checkStep(step)) go(step + 1);
            return;
          }
          for (let i = 0; i < STEPS; i++) {
            if (!checkStep(i)) {
              e.preventDefault();
              if (i !== step) setStep(i);
              return;
            }
          }
        }}
      >
        <input type="hidden" name="t" value={token} />
        {/* Honeypot: invisible to people, irresistible to bots. */}
        <div aria-hidden="true" className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden">
          <label>
            Leave this empty
            <input type="text" name="homepage" tabIndex={-1} autoComplete="off" defaultValue="" />
          </label>
        </div>

        {/* ── Step 1 — About you ── */}
        <Step index={0} current={step} refs={stepRefs}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Text {...p} name="businessName" required max={160} autoComplete="organization" />
            <Text {...p} name="contactName" required max={120} autoComplete="name" />
            <Text {...p} name="email" type="email" required max={200} autoComplete="email" inputMode="email" />
            <Text {...p} name="phone" type="tel" max={40} autoComplete="tel" inputMode="tel" />
            <Select {...p} name="role" options={ROLES} />
            <Select {...p} name="businessType" options={BUSINESS_TYPES} />
            <Text {...p} name="city" required max={120} autoComplete="address-level2" />
            <Text {...p} name="address" max={200} autoComplete="street-address" />
            <Text {...p} name="instagram" max={60} handle />
            <Text {...p} name="tiktok" max={60} handle />
            <div className="sm:col-span-2">
              <Text {...p} name="website" max={300} autoComplete="url" inputMode="url" handle />
            </div>
          </div>
        </Step>

        {/* ── Step 2 — The collab ── */}
        <Step index={1} current={step} refs={stepRefs}>
          <div className="space-y-6">
            <Group label={FIELDS.interests.label} hint={FIELDS.interests.hint} required error={errors.interests}>
              <Chips name="interests" options={INTERESTS} checked={arr("interests")} onChange={() => local.interests && setLocal(({ interests: _drop, ...rest }) => rest)} />
            </Group>
            <Group label={FIELDS.deliverables.label} hint={FIELDS.deliverables.hint} error={errors.deliverables}>
              <Chips name="deliverables" options={DELIVERABLES} checked={arr("deliverables")} />
            </Group>
            <Group label={FIELDS.compensation.label} required error={errors.compensation}>
              <Radios name="compensation" options={COMPENSATION} checked={val("compensation")} required onChange={setComp} />
            </Group>
            <div data-off={!paid} className="data-[off=true]:hidden collab-cond">
              <Select {...p} name="budget" options={BUDGETS} hint={C.budgetHint} />
            </div>
            <Group label={FIELDS.idealDate.label} error={errors.idealDate}>
              <div className="flex flex-wrap items-center gap-3">
                <div className="w-full sm:w-56">
                  <input type="date" name="idealDate" aria-label={FIELDS.idealDate.label} defaultValue={val("idealDate")} className="input" />
                </div>
                <label className="inline-flex min-h-11 items-center gap-2 text-[15px]">
                  <input type="checkbox" name="flexible" defaultChecked={val("flexible") === "on"} />
                  {FIELDS.flexible.label}
                </label>
              </div>
            </Group>
            <Text {...p} name="deadline" max={200} />
            <Group label={FIELDS.usage.label} hint={C.paidUsageNote} error={errors.usage}>
              <Radios name="usage" options={USAGE} checked={val("usage")} />
            </Group>
            <Text {...p} name="exclusivity" max={300} />
          </div>
        </Step>

        {/* ── Step 3 — Details ── */}
        <Step index={2} current={step} refs={stepRefs}>
          <div className="space-y-4">
            <Area {...p} name="special" max={2000} rows={4} />
            <Area {...p} name="dietary" max={1000} rows={2} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Text {...p} name="bestTimes" max={300} />
              <Select {...p} name="heardFrom" options={HEARD_FROM} />
            </div>
            <Area {...p} name="restrictions" max={1000} rows={2} />
            <Area {...p} name="links" max={1500} rows={2} />
            <Area {...p} name="anythingElse" max={2000} rows={3} />

            <div className="space-y-2 rounded-xl bg-surface-2 p-3 sm:p-4">
              <Ack name="ackDisclosure" text={C.acks.disclosure} checked={val("ackDisclosure") === "on"} error={errors.ackDisclosure} />
              <Ack name="ackHonest" text={C.acks.honest} checked={val("ackHonest") === "on"} error={errors.ackHonest} />
            </div>
          </div>
        </Step>

        <div className="sticky-actions mt-8">
          <div className="flex items-center gap-3 rounded-2xl border border-border bg-surface/95 p-2 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-surface/80">
            <button
              type="button"
              onClick={() => go(step - 1)}
              data-off={step === 0}
              className={cx(buttonClass("ghost"), "collab-js min-h-11 data-[off=true]:invisible")}
            >
              {C.back}
            </button>
            <span className="collab-js ml-auto text-xs tabular-nums text-muted">
              {step + 1} / {STEPS}
            </span>
            <button
              type="button"
              data-off={step === STEPS - 1}
              onClick={() => checkStep(step) && go(step + 1)}
              className={cx(buttonClass("primary"), "collab-js min-h-11 px-6 data-[off=true]:hidden")}
            >
              {C.next}
            </button>
            <button
              type="submit"
              disabled={pending}
              data-off={step !== STEPS - 1}
              className={cx(buttonClass("primary"), "collab-submit min-h-11 px-6 data-[off=true]:hidden")}
            >
              {pending ? C.sending : C.submit}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

/* ───────────────────────── Pieces ───────────────────────── */

function Progress({ step }: { step: number }) {
  return (
    <div className="collab-js mb-6" aria-live="polite">
      <div className="mb-2 flex items-baseline justify-between gap-3 text-sm">
        <span className="font-semibold">{C.steps[step].title}</span>
        <span className="text-muted">Step {step + 1} of {STEPS}</span>
      </div>
      <div className="grid grid-cols-3 gap-1.5" aria-hidden>
        {C.steps.map((s, i) => (
          <span key={s.title} className={cx("h-1.5 rounded-full transition-colors", i <= step ? "bg-accent" : "bg-surface-2")} />
        ))}
      </div>
    </div>
  );
}

function Step({ index, current, refs, children }: { index: number; current: number; refs: React.RefObject<Array<HTMLElement | null>>; children: ReactNode }) {
  const s = C.steps[index];
  return (
    <section
      ref={(el) => { refs.current[index] = el; }}
      data-off={index !== current}
      aria-labelledby={`collab-step-${index}`}
      className="collab-step data-[off=true]:hidden"
    >
      <header className="mb-5">
        <h2 id={`collab-step-${index}`} tabIndex={-1} className="text-lg font-semibold tracking-tight outline-none">
          <span className="collab-nojs mr-1 hidden text-muted">{index + 1}.</span>
          {s.title}
        </h2>
        <p className="mt-0.5 text-[15px] text-muted">{s.blurb}</p>
      </header>
      {children}
    </section>
  );
}

type Common = { val: (k: string) => string; arr: (k: string) => string[]; errors: Partial<Record<CollabField, string>> };
type FieldName = keyof typeof FIELDS;

function labelOf(name: FieldName) {
  return FIELDS[name].label;
}
function placeholderOf(name: FieldName) {
  const f = FIELDS[name] as { placeholder?: string };
  return f.placeholder || undefined;
}

function Label({ htmlFor, children, required, optional }: { htmlFor?: string; children: ReactNode; required?: boolean; optional?: boolean }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium">
      {children}
      {required && <span className="ml-0.5 text-accent" aria-hidden>*</span>}
      {optional && <span className="ml-1 font-normal text-muted">(optional)</span>}
    </label>
  );
}

function ErrorText({ id, error }: { id: string; error?: string }) {
  if (!error) return null;
  return <p id={id} className="mt-1.5 text-sm text-danger">{error}</p>;
}

function Text({
  name, required, max, type = "text", autoComplete, inputMode, handle, val, errors,
}: Common & {
  name: FieldName; required?: boolean; max: number; type?: string; autoComplete?: string;
  inputMode?: "email" | "tel" | "url" | "text"; handle?: boolean;
}) {
  const id = `f-${name}`;
  const err = errors[name];
  return (
    <div>
      <Label htmlFor={id} required={required}>{labelOf(name)}</Label>
      <input
        id={id}
        name={name}
        type={type}
        required={required}
        maxLength={max}
        autoComplete={autoComplete ?? "off"}
        inputMode={inputMode}
        autoCapitalize={handle || type === "email" ? "none" : undefined}
        autoCorrect={handle || type === "email" ? "off" : undefined}
        spellCheck={handle || type === "email" ? false : undefined}
        placeholder={placeholderOf(name)}
        defaultValue={val(name)}
        aria-invalid={err ? true : undefined}
        aria-describedby={err ? `${id}-err` : undefined}
        className={cx("input", err && "!border-danger")}
      />
      <ErrorText id={`${id}-err`} error={err} />
    </div>
  );
}

function Area({ name, max, rows = 3, val, errors }: Common & { name: FieldName; max: number; rows?: number }) {
  const id = `f-${name}`;
  const err = errors[name];
  return (
    <div>
      <Label htmlFor={id}>{labelOf(name)}</Label>
      <textarea
        id={id}
        name={name}
        rows={rows}
        maxLength={max}
        placeholder={placeholderOf(name)}
        defaultValue={val(name)}
        aria-invalid={err ? true : undefined}
        aria-describedby={err ? `${id}-err` : undefined}
        className={cx("input !min-h-0", err && "!border-danger")}
      />
      <ErrorText id={`${id}-err`} error={err} />
    </div>
  );
}

function Select({ name, options, hint, val, errors }: Common & { name: FieldName; options: Option[]; hint?: string }) {
  const id = `f-${name}`;
  const err = errors[name];
  return (
    <div>
      <Label htmlFor={id}>{labelOf(name)}</Label>
      <select id={id} name={name} defaultValue={val(name)} className={cx("input", err && "!border-danger")} aria-invalid={err ? true : undefined}>
        <option value="">Choose…</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {hint && <p className="mt-1.5 text-sm text-muted">{hint}</p>}
      <ErrorText id={`${id}-err`} error={err} />
    </div>
  );
}

function Group({ label, hint, required, error, children }: { label: string; hint?: string; required?: boolean; error?: string; children: ReactNode }) {
  return (
    <fieldset aria-invalid={error ? true : undefined}>
      <legend className="mb-1.5 text-sm font-medium">
        {label}
        {required && <span className="ml-0.5 text-accent" aria-hidden>*</span>}
      </legend>
      {hint && <p className="-mt-0.5 mb-2 text-sm text-muted">{hint}</p>}
      {children}
      {error && <p className="mt-1.5 text-sm text-danger" role="alert">{error}</p>}
    </fieldset>
  );
}

const pill =
  "inline-flex min-h-11 cursor-pointer select-none items-center gap-2 rounded-full border border-border bg-surface px-3.5 py-2 text-[15px] transition-colors " +
  "hover:bg-surface-2 has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent";

function Chips({ name, options, checked, onChange }: { name: string; options: Option[]; checked: string[]; onChange?: () => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <label key={o.value} className={pill} title={o.hint}>
          <input type="checkbox" name={name} value={o.value} defaultChecked={checked.includes(o.value)} onChange={onChange} className="shrink-0" />
          <span>
            {o.label}
            {o.hint && <span className="block text-xs text-muted">{o.hint}</span>}
          </span>
        </label>
      ))}
    </div>
  );
}

function Radios({ name, options, checked, required, onChange }: { name: string; options: Option[]; checked: string; required?: boolean; onChange?: (v: string) => void }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {options.map((o) => (
        <label key={o.value} className={cx(pill, "rounded-xl")}>
          <input
            type="radio"
            name={name}
            value={o.value}
            required={required}
            defaultChecked={checked === o.value}
            onChange={(e) => e.currentTarget.checked && onChange?.(o.value)}
            className="shrink-0"
          />
          <span>
            {o.label}
            {o.hint && <span className="ml-1.5 text-sm text-muted">· {o.hint}</span>}
          </span>
        </label>
      ))}
    </div>
  );
}

function Ack({ name, text, checked, error }: { name: string; text: string; checked: boolean; error?: string }) {
  return (
    <div>
      <label className="flex min-h-11 cursor-pointer items-start gap-3 py-1 text-[15px] leading-snug">
        <input type="checkbox" name={name} required defaultChecked={checked} className="mt-0.5 shrink-0" />
        <span>{text}</span>
      </label>
      {error && <p className="ml-8 text-sm text-danger">{error}</p>}
    </div>
  );
}

function Thanks({ name, email }: { name: string; email: string }) {
  return (
    <div role="status" className="px-2 py-8 text-center">
      <span aria-hidden className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-ok-soft text-xl text-ok">✓</span>
      <h2 className="text-xl font-semibold tracking-tight">{C.thanksTitle(name)}</h2>
      <p className="mx-auto mt-2 max-w-sm text-[15px] leading-relaxed text-muted">{C.thanksBody(email || "your email")}</p>
      <p className="mx-auto mt-4 max-w-sm text-sm text-muted">{C.thanksFoot}</p>
    </div>
  );
}
