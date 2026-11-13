"use client";

import { useActionState, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { submitIntakeAction, type IntakeFormState } from "@/app/start/[token]/actions";
import {
  CHOICE_FIELDS, INTAKE_STEP_COUNT, INTAKE_STEP_FIELDS, TEXT_FIELDS, intakeCopy,
  type ChoiceField, type IntakeCopy, type IntakeField, type IntakeLangCode, type TextField,
} from "@/lib/intake-copy";
import { IntakeAlready, IntakeExpired, IntakeThanks } from "./intake-screens";
import { IntakeUpload, type IntakeUploadedFile } from "./intake-upload";
import { copyText } from "./copy-button";
import { buttonClass, cx } from "./ui";

/**
 * The client onboarding form (/start/<token>): 7 friendly steps on one route, in the language picked at the top.
 * - Answers autosave to localStorage (per link) as you type and come back after a reload or a language switch.
 * - With JavaScript off it renders as one long form (the page's <noscript> style un-hides every step) and still
 *   submits to the same server action.
 * - Only the business name, the contact's name and a phone or email are needed; server-side zod is the source of truth.
 */

type Values = Record<string, string | string[]>;
type Errors = Partial<Record<IntakeField, string>>;

const LAST = INTAKE_STEP_COUNT - 1;
const storageKey = (intakeId: string) => `nhq-intake-${intakeId}`;
const KNOWN = [...Object.keys(TEXT_FIELDS), ...Object.keys(CHOICE_FIELDS)];
const stepOf = (f: IntakeField) => Math.max(0, INTAKE_STEP_FIELDS.findIndex((list) => list.includes(f)));

type InputCfg = { type?: string; autoComplete?: string; inputMode?: "email" | "tel" | "url" | "text"; required?: boolean; rows?: number; plain?: boolean };
const INPUT: Partial<Record<TextField, InputCfg>> = {
  businessName: { required: true, autoComplete: "organization" },
  address: { autoComplete: "street-address" },
  phone: { type: "tel", inputMode: "tel" },
  website: { inputMode: "url", plain: true },
  hours: { rows: 3 },
  signatureDishes: { rows: 3 },
  story: { rows: 4 },
  different: { rows: 3 },
  upcoming: { rows: 3 },
  avoid: { rows: 2 },
  likedAccounts: { rows: 2 },
  mediaLink: { inputMode: "url", plain: true },
  instagram: { plain: true },
  facebook: { inputMode: "url", plain: true },
  tiktok: { plain: true },
  google: { plain: true },
  yelp: { inputMode: "url", plain: true },
  neverMention: { rows: 2 },
  noFilm: { rows: 2 },
  contactName: { required: true, autoComplete: "name" },
  contactPhone: { type: "tel", autoComplete: "tel", inputMode: "tel" },
  contactEmail: { type: "email", autoComplete: "email", inputMode: "email", plain: true },
  wechatId: { plain: true },
  anythingElse: { rows: 4 },
};

function readValues(form: HTMLFormElement): Values {
  const fd = new FormData(form);
  const out: Values = {};
  for (const k of KNOWN) {
    const isMulti = (CHOICE_FIELDS as Record<string, { multi: boolean }>)[k]?.multi;
    if (isMulti) out[k] = fd.getAll(k).filter((v): v is string => typeof v === "string");
    else {
      const v = fd.get(k);
      if (typeof v === "string") out[k] = v;
    }
  }
  return out;
}

function applyValues(form: HTMLFormElement, values: Values) {
  for (const k of KNOWN) {
    if (!(k in values)) continue;
    const v = values[k];
    const item = form.elements.namedItem(k);
    if (!item) continue;
    if (item instanceof RadioNodeList) {
      const list = Array.isArray(v) ? v : [v];
      item.forEach((n) => {
        if (n instanceof HTMLInputElement) n.checked = list.includes(n.value);
      });
    } else if (item instanceof HTMLInputElement && (item.type === "checkbox" || item.type === "radio")) {
      const list = Array.isArray(v) ? v : [v];
      item.checked = list.includes(item.value);
    } else if (item instanceof HTMLInputElement || item instanceof HTMLTextAreaElement) {
      if (typeof v === "string") item.value = v;
    }
  }
}

export function IntakeForm({
  token, intakeId, lang, businessName, initial, accessEmail, uploadsEnabled,
}: {
  token: string;
  intakeId: string;
  lang: IntakeLangCode;
  businessName: string;
  initial: Values;
  accessEmail: string | null;
  uploadsEnabled: boolean;
}) {
  const C = intakeCopy(lang);
  const [state, formAction, pending] = useActionState<IntakeFormState, FormData>(submitIntakeAction, {});
  const [step, setStep] = useState(0);
  const [local, setLocal] = useState<Errors>({});
  const [restored, setRestored] = useState(false);
  const [uploads, setUploads] = useState<IntakeUploadedFile[]>([]);
  const formRef = useRef<HTMLFormElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const stepRefs = useRef<Array<HTMLElement | null>>([]);
  const didRestore = useRef(false);
  const saveTimer = useRef<number | null>(null);
  const v = state.values ?? initial;
  const errors: Errors = { ...state.errors, ...local };

  const save = useCallback((nextStep?: number, nextUploads?: IntakeUploadedFile[]) => {
    const form = formRef.current;
    if (!form) return;
    try {
      localStorage.setItem(storageKey(intakeId), JSON.stringify({ v: readValues(form), step: nextStep ?? step, uploads: nextUploads ?? uploads, at: Date.now() }));
    } catch {
      /* private mode / storage full: the form still works, it just won't remember */
    }
  }, [intakeId, step, uploads]);

  const saveSoon = () => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => save(), 400);
  };

  // JS is running: we validate per step ourselves (hidden steps would otherwise block native validation).
  useEffect(() => {
    if (formRef.current) formRef.current.noValidate = true;
  }, [state.at]);

  // Pick up where they left off (once, on first load).
  useEffect(() => {
    if (didRestore.current) return;
    didRestore.current = true;
    try {
      const raw = localStorage.getItem(storageKey(intakeId));
      if (!raw) return;
      const saved = JSON.parse(raw) as { v?: Values; step?: number; uploads?: IntakeUploadedFile[] };
      if (formRef.current && saved.v) applyValues(formRef.current, saved.v);
      if (Array.isArray(saved.uploads)) setUploads(saved.uploads.filter((u) => u && typeof u.url === "string").slice(0, 30));
      if (typeof saved.step === "number") setStep(Math.min(LAST, Math.max(0, Math.floor(saved.step))));
      if (saved.v || saved.step) setRestored(true);
    } catch {
      /* unreadable storage: start fresh */
    }
  }, [intakeId]);

  // Sent: forget the local copy.
  useEffect(() => {
    if (!state.done && !state.gone) return;
    try {
      localStorage.removeItem(storageKey(intakeId));
    } catch {
      /* ignore */
    }
  }, [state.done, state.gone, intakeId]);

  // Server came back with errors: go to the first step that has one.
  useEffect(() => {
    if (!state.at || state.done || state.gone) return;
    const keys = Object.keys(state.errors ?? {}) as IntakeField[];
    if (keys.length) setStep(Math.min(...keys.map(stepOf)));
    topRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [state.at, state.done, state.gone, state.errors]);

  if (state.done) return <IntakeThanks C={C} name={state.done.name} />;
  if (state.gone === "submitted") return <IntakeAlready C={C} />;
  if (state.gone === "expired") return <IntakeExpired C={C} />;

  const go = (n: number) => {
    const to = Math.min(LAST, Math.max(0, n));
    setStep(to);
    save(to);
    requestAnimationFrame(() => {
      topRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
      stepRefs.current[to]?.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
    });
  };

  const clearLocal = (k: IntakeField) => local[k] && setLocal(({ [k]: _drop, ...rest }) => rest);

  const checkStep = (n: number): boolean => {
    const root = stepRefs.current[n];
    const form = formRef.current;
    if (!root || !form) return true;
    const next: Errors = {};
    const val = (k: string) => String(new FormData(form).get(k) ?? "").trim();
    if (n === 1 && !val("businessName")) next.businessName = C.errors.businessName;
    if (n === LAST) {
      if (!val("contactName")) next.contactName = C.errors.contactName;
      if (!val("contactPhone") && !val("contactEmail")) next.contactPhone = C.errors.contactMethod;
      const email = form.elements.namedItem("contactEmail");
      if (email instanceof HTMLInputElement && email.value.trim() && !email.checkValidity()) next.contactEmail = C.errors.email;
    }
    setLocal(next);
    const first = Object.keys(next)[0];
    if (first) {
      root.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
      return false;
    }
    return true;
  };

  const p = { C, v, errors, clearLocal };

  return (
    <div ref={topRef} className="scroll-mt-4">
      <Progress C={C} step={step} />

      {restored && step > 0 && (
        <div className="intake-js mb-5 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-info-soft px-4 py-3 text-[15px] text-info">
          <span className="min-w-0 flex-1">{C.common.restored}</span>
          <button
            type="button"
            className="min-h-10 rounded-lg px-2 font-medium underline underline-offset-2"
            onClick={() => {
              try {
                localStorage.removeItem(storageKey(intakeId));
              } catch {
                /* ignore */
              }
              formRef.current?.reset();
              setUploads([]);
              setRestored(false);
              setLocal({});
              go(0);
            }}
          >
            {C.common.startOver}
          </button>
        </div>
      )}

      {state.error && (
        <p role="alert" className="mb-5 rounded-xl bg-danger-soft px-4 py-3 text-[16px] text-danger">{state.error}</p>
      )}

      <form
        key={state.at ?? 0}
        ref={formRef}
        action={formAction}
        className="intake-form"
        onInput={saveSoon}
        onChange={saveSoon}
        onSubmit={(e) => {
          // Enter on an earlier step moves forward instead of sending.
          if (step < LAST) {
            e.preventDefault();
            if (checkStep(step)) go(step + 1);
            return;
          }
          for (const n of [1, LAST]) {
            if (!checkStep(n)) {
              e.preventDefault();
              if (n !== step) go(n);
              return;
            }
          }
          save();
        }}
      >
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="lang" value={lang} />
        <input type="hidden" name="uploads" value={JSON.stringify(uploads)} />
        {/* Honeypot: invisible to people, irresistible to bots. */}
        <div aria-hidden="true" className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden">
          <label>
            Leave this empty
            <input type="text" name="homepage" tabIndex={-1} autoComplete="off" defaultValue="" />
          </label>
        </div>

        {/* ── 1 · Welcome ── */}
        <Step C={C} index={0} current={step} refs={stepRefs}>
          <div className="space-y-4 text-[17px] leading-relaxed">
            <p className="text-2xl font-semibold tracking-tight">{C.welcome.hi(businessName)}</p>
            <p>{C.welcome.intro}</p>
            <p className="text-muted">{C.welcome.purpose}</p>
            <ul className="space-y-2.5 rounded-2xl bg-surface-2 p-4">
              {C.welcome.points.map((pt) => (
                <li key={pt} className="flex gap-3 text-[16px]">
                  <span aria-hidden className="mt-0.5 text-ok">✓</span>
                  <span>{pt}</span>
                </li>
              ))}
            </ul>
            <p className="text-[15px] text-muted">🔒 {C.common.privacy}</p>
          </div>
        </Step>

        {/* ── 2 · Your business ── */}
        <Step C={C} index={1} current={step} refs={stepRefs} skip>
          <Fields {...p} names={INTAKE_STEP_FIELDS[1]} />
        </Step>

        {/* ── 3 · Customers & goals ── */}
        <Step C={C} index={2} current={step} refs={stepRefs} skip>
          <Fields {...p} names={INTAKE_STEP_FIELDS[2]} />
        </Step>

        {/* ── 4 · Look & voice ── */}
        <Step C={C} index={3} current={step} refs={stepRefs} skip>
          <Fields {...p} names={["tone", "emojis", "postLangs", "avoid", "likedAccounts", "mediaLink"]} />
          {uploadsEnabled && (
            <div className="mt-6">
              <IntakeUpload
                C={C}
                token={token}
                intakeId={intakeId}
                files={uploads}
                onChange={(next) => {
                  setUploads(next);
                  save(undefined, next);
                }}
              />
            </div>
          )}
        </Step>

        {/* ── 5 · Accounts + access ── */}
        <Step C={C} index={4} current={step} refs={stepRefs} skip>
          <Fields {...p} names={["instagram", "facebook", "tiktok", "google", "yelp"]} />
          <Access C={C} v={v} accessEmail={accessEmail} />
        </Step>

        {/* ── 6 · Reviews & creators ── */}
        <Step C={C} index={5} current={step} refs={stepRefs} skip>
          <Fields {...p} names={INTAKE_STEP_FIELDS[5]} />
        </Step>

        {/* ── 7 · Contact & approvals ── */}
        <Step C={C} index={6} current={step} refs={stepRefs} skip>
          <Fields {...p} names={["contactName", "contactRole"]} />
          <p className="mb-4 mt-6 rounded-xl bg-accent-soft px-4 py-3 text-[15px] leading-relaxed">{C.needContact}</p>
          <Fields {...p} names={["contactPhone", "contactEmail", "talkLang", "talkLangOther", "reachBy", "wechatId", "approver", "approvalSpeed", "anythingElse"]} />
        </Step>

        <div className="sticky-actions mt-8">
          <div className="flex items-center gap-3 rounded-2xl border border-border bg-surface/95 p-2 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-surface/80">
            <button
              type="button"
              onClick={() => go(step - 1)}
              data-off={step === 0}
              className={cx(buttonClass("ghost"), "intake-js min-h-12 px-4 text-[16px] data-[off=true]:invisible")}
            >
              ← {C.common.back}
            </button>
            <span className="intake-js ml-auto text-sm tabular-nums text-muted">{step + 1} / {INTAKE_STEP_COUNT}</span>
            <button
              type="button"
              data-off={step === LAST}
              onClick={() => checkStep(step) && go(step + 1)}
              className={cx(buttonClass("primary"), "intake-js min-h-12 px-6 text-[16px] data-[off=true]:hidden")}
            >
              {step === 0 ? C.common.start : C.common.next} →
            </button>
            <button
              type="submit"
              disabled={pending}
              data-off={step !== LAST}
              className={cx(buttonClass("primary"), "intake-submit min-h-12 px-6 text-[16px] data-[off=true]:hidden")}
            >
              {pending ? C.common.sending : C.common.submit}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

/* ───────────────────────── Pieces ───────────────────────── */

function Progress({ C, step }: { C: IntakeCopy; step: number }) {
  return (
    <div className="intake-js mb-6" aria-live="polite">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="text-[16px] font-semibold">{C.steps[step].title}</span>
        <span className="text-sm text-muted">{C.common.stepOf(step + 1, INTAKE_STEP_COUNT)}</span>
      </div>
      <div className="grid grid-cols-7 gap-1.5" aria-hidden>
        {C.steps.map((s, i) => (
          <span key={i} className={cx("h-2 rounded-full transition-colors", i <= step ? "bg-accent" : "bg-surface-2")} />
        ))}
      </div>
    </div>
  );
}

function Step({
  C, index, current, refs, skip, children,
}: { C: IntakeCopy; index: number; current: number; refs: React.RefObject<Array<HTMLElement | null>>; skip?: boolean; children: ReactNode }) {
  const s = C.steps[index];
  return (
    <section
      ref={(el) => { refs.current[index] = el; }}
      data-off={index !== current}
      aria-labelledby={`intake-step-${index}`}
      className="intake-step data-[off=true]:hidden"
    >
      <header className="mb-6">
        <h2 id={`intake-step-${index}`} tabIndex={-1} className="text-xl font-semibold tracking-tight outline-none">
          <span className="intake-nojs mr-1 hidden text-muted">{index + 1}.</span>
          {s.title}
        </h2>
        <p className="mt-1 text-[16px] text-muted">{s.blurb}</p>
        {skip && <p className="mt-2 text-[15px] text-muted">💡 {C.common.skip}</p>}
      </header>
      {children}
    </section>
  );
}

type Common = { C: IntakeCopy; v: Values; errors: Errors; clearLocal: (k: IntakeField) => void };

function Fields({ names, ...p }: Common & { names: IntakeField[] }) {
  return (
    <div className="space-y-6">
      {names.map((n) => {
        if (n === "uploads") return null;
        if (n in CHOICE_FIELDS) return <Choice key={n} {...p} name={n as ChoiceField} />;
        return <Text key={n} {...p} name={n as TextField} />;
      })}
    </div>
  );
}

function FieldHead({ C, name, htmlFor, required }: { C: IntakeCopy; name: IntakeField; htmlFor?: string; required?: boolean }) {
  const f = C.fields[name] as { label: string; hint?: string; placeholder?: string };
  const Tag = htmlFor ? "label" : "span";
  return (
    <div className="mb-2">
      <Tag {...(htmlFor ? { htmlFor } : {})} className="block text-[16px] font-medium leading-snug">
        {f.label}
        {required && <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 align-middle text-xs font-semibold text-accent">{C.common.required}</span>}
      </Tag>
      {f.hint && <p className="mt-0.5 text-[15px] leading-snug text-muted">{f.hint}</p>}
      {f.placeholder && (
        <p className="mt-0.5 text-[15px] leading-snug text-muted">
          <span className="font-medium">{C.common.example}</span> {f.placeholder}
        </p>
      )}
    </div>
  );
}

function ErrorText({ id, error }: { id: string; error?: string }) {
  if (!error) return null;
  return <p id={id} role="alert" className="mt-1.5 text-[15px] text-danger">{error}</p>;
}

function Text({ C, v, errors, clearLocal, name }: Common & { name: TextField }) {
  const spec = TEXT_FIELDS[name];
  const cfg = INPUT[name] ?? {};
  const id = `f-${name}`;
  const err = errors[name];
  const def = typeof v[name] === "string" ? (v[name] as string) : "";
  const common = {
    id,
    name,
    maxLength: spec.max,
    defaultValue: def,
    required: cfg.required,
    "aria-invalid": err ? true : undefined,
    "aria-describedby": err ? `${id}-err` : undefined,
    onInput: () => clearLocal(name),
  } as const;
  return (
    <div>
      <FieldHead C={C} name={name} htmlFor={id} required={cfg.required} />
      {spec.kind === "block" ? (
        <textarea {...common} rows={cfg.rows ?? 3} className={cx("input !min-h-0 !text-[16px] leading-relaxed", err && "!border-danger")} />
      ) : (
        <input
          {...common}
          type={cfg.type ?? "text"}
          autoComplete={cfg.autoComplete ?? "off"}
          inputMode={cfg.inputMode}
          autoCapitalize={cfg.plain ? "none" : undefined}
          autoCorrect={cfg.plain ? "off" : undefined}
          spellCheck={cfg.plain ? false : undefined}
          className={cx("input !min-h-12 !text-[16px]", err && "!border-danger")}
        />
      )}
      <ErrorText id={`${id}-err`} error={err} />
    </div>
  );
}

const pill =
  "inline-flex min-h-12 cursor-pointer select-none items-center gap-2.5 rounded-full border border-border bg-surface px-4 py-2 text-[16px] transition-colors " +
  "hover:bg-surface-2 has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent";

function Choice({ C, v, errors, name }: Common & { name: ChoiceField }) {
  const spec = CHOICE_FIELDS[name];
  const labels = C.options[name] as Record<string, string>;
  const cur = v[name];
  const checked = Array.isArray(cur) ? cur : typeof cur === "string" && cur ? [cur] : [];
  const err = errors[name];
  return (
    <fieldset aria-invalid={err ? true : undefined}>
      <legend className="contents">
        <FieldHead C={C} name={name} />
      </legend>
      <div className={spec.multi ? "flex flex-wrap gap-2" : "grid gap-2 sm:grid-cols-2"}>
        {spec.values.map((val) => (
          <label key={val} className={cx(pill, !spec.multi && "rounded-xl")}>
            <input type={spec.multi ? "checkbox" : "radio"} name={name} value={val} defaultChecked={checked.includes(val)} className="shrink-0" />
            <span>{labels[val]}</span>
          </label>
        ))}
      </div>
      {err && <p role="alert" className="mt-1.5 text-[15px] text-danger">{err}</p>}
    </fieldset>
  );
}

function CopyEmail({ C, email }: { C: IntakeCopy; email: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={cx(buttonClass("secondary", "sm"), "intake-js min-h-10 shrink-0")}
      onClick={async () => {
        const ok = await copyText(email);
        setDone(ok);
        if (ok) window.setTimeout(() => setDone(false), 2000);
      }}
    >
      <span aria-live="polite">{done ? C.common.copied : C.common.copy}</span>
    </button>
  );
}

/** "How to give us access": plain, numbered steps per platform, each with Done / I'll need help. Never asks for passwords. */
function Access({ C, v, accessEmail }: { C: IntakeCopy; v: Values; accessEmail: string | null }) {
  const A = C.access;
  const email = accessEmail ?? A.emailFallback;
  const fill = (s: string) => {
    const [before, after] = s.split("{email}");
    if (after === undefined) return s;
    return (
      <>
        {before}
        <strong className="break-all font-semibold">{email}</strong>
        {after}
      </>
    );
  };
  const radios = (name: "accessMeta" | "accessGoogle" | "accessTiktok") => {
    const cur = typeof v[name] === "string" ? (v[name] as string) : "";
    const labels = C.options[name] as Record<string, string>;
    return (
      <fieldset className="mt-4">
        <legend className="sr-only">{C.fields[name].label}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {CHOICE_FIELDS[name].values.map((val) => (
            <label key={val} className={cx(pill, "rounded-xl")}>
              <input type="radio" name={name} value={val} defaultChecked={cur === val} className="shrink-0" />
              <span>{labels[val]}</span>
            </label>
          ))}
        </div>
      </fieldset>
    );
  };
  const steps = (list: readonly string[]) => (
    <ol className="space-y-2.5">
      {list.map((s, i) => (
        <li key={i} className="flex gap-3 text-[16px] leading-relaxed">
          <span aria-hidden className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-sm font-semibold">{i + 1}</span>
          <span className="min-w-0">{fill(s)}</span>
        </li>
      ))}
    </ol>
  );

  return (
    <div className="mt-10 border-t border-border pt-8">
      <h3 className="text-xl font-semibold tracking-tight">{A.title}</h3>
      <p className="mt-1 text-[16px] leading-relaxed text-muted">{A.intro}</p>
      <p className="mt-4 flex gap-2 rounded-xl border border-warn/40 bg-warn-soft px-4 py-3 text-[16px] font-medium text-warn">
        <span aria-hidden>🔒</span>
        <span>{C.common.neverPasswords}</span>
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-surface-2 px-4 py-3">
        <span className="text-[15px] text-muted">{A.emailLabel}</span>
        <span className="min-w-0 break-all text-[17px] font-semibold">{email}</span>
        {accessEmail && <CopyEmail C={C} email={accessEmail} />}
      </div>

      <div className="mt-6 space-y-5">
        <div className="rounded-2xl border border-border p-4">
          <h4 className="mb-3 text-[17px] font-semibold">{A.meta.title}</h4>
          {steps(A.meta.steps)}
          {radios("accessMeta")}
        </div>
        <div className="rounded-2xl border border-border p-4">
          <h4 className="mb-3 text-[17px] font-semibold">{A.google.title}</h4>
          {steps(A.google.steps)}
          {radios("accessGoogle")}
        </div>
        <div className="rounded-2xl border border-border p-4">
          <h4 className="mb-2 text-[17px] font-semibold">{A.tiktok.title}</h4>
          <p className="text-[16px] leading-relaxed">{A.tiktok.body}</p>
          {radios("accessTiktok")}
        </div>
      </div>
      <p className="mt-4 text-[15px] text-muted">💡 {A.tip}</p>
    </div>
  );
}
