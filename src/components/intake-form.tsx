"use client";

import { useActionState, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { submitIntakeAction, type IntakeFormState } from "@/app/start/[token]/actions";
import {
  CHOICE_FIELDS, INTAKE_STEP_COUNT, INTAKE_STEP_FIELDS, TEXT_FIELDS, intakeCopy,
  type ChoiceField, type IntakeCopy, type IntakeFactKey, type IntakeField, type IntakeLangCode, type TextField,
} from "@/lib/intake-copy";
import { IntakeAlready, IntakeExpired, IntakeThanks } from "./intake-screens";
import { IntakeUpload, type IntakeUploadedFile } from "./intake-upload";
import { copyText } from "./copy-button";
import { buttonClass, cx } from "./ui";

/**
 * The client onboarding form (/start/<token>): 3 short pages on one route, in the language picked at the top.
 *   1 · "Is this right?": the facts we looked up before sending, on one card with a one-tap "Yes, that's right" /
 *       "Something's off" (which opens ONE text box); then how to reach them. The only page with required answers.
 *   2 · Accounts & photos  3 · How we'll work together — both optional ("Got one more minute?").
 * - "Send now" (pages 1 and 2) sends what's there, so a busy owner is done after page 1.
 * - Facts we couldn't find are simply left out; with none at all there is no card. The owner never types an address
 *   or opening hours.
 * - Answers autosave to localStorage (per link) as you type and come back after a reload or a language switch.
 * - With JavaScript off it renders as one long form (the page's <noscript> style un-hides every step) and still
 *   submits to the same server action.
 * - Only the contact's name and a phone or email are needed; server-side zod is the source of truth.
 * - `preview` (team only): the same form with nothing saved, uploaded or sent.
 */

type Values = Record<string, string | string[]>;
type Errors = Partial<Record<IntakeField, string>>;

const LAST = INTAKE_STEP_COUNT - 1;
const storageKey = (intakeId: string) => `nhq-intake-${intakeId}`;
/** Stamped on the copy saved on the device. A copy from the earlier 7-step form has none: its answers come back, but it starts on page 1. */
const SAVE_VERSION = 3;
const KNOWN = [...Object.keys(TEXT_FIELDS), ...Object.keys(CHOICE_FIELDS)];
const stepOf = (f: IntakeField) => Math.max(0, INTAKE_STEP_FIELDS.findIndex((list) => list.includes(f)));

type InputCfg = { type?: string; autoComplete?: string; inputMode?: "email" | "tel" | "url" | "text"; required?: boolean; rows?: number; plain?: boolean };
const INPUT: Partial<Record<TextField, InputCfg>> = {
  contactName: { required: true, autoComplete: "name" },
  contactPhone: { type: "tel", autoComplete: "tel", inputMode: "tel" },
  contactEmail: { type: "email", autoComplete: "email", inputMode: "email", plain: true },
  factsFix: { rows: 3 },
  instagram: { plain: true },
  tiktok: { plain: true },
  facebook: { inputMode: "url", plain: true },
  mediaLink: { inputMode: "url", plain: true },
  promote: { rows: 4 },
  anythingElse: { rows: 3 },
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
    } else if (item instanceof HTMLSelectElement) {
      if (typeof v === "string" && [...item.options].some((o) => o.value === v)) item.value = v;
    } else if (item instanceof HTMLInputElement || item instanceof HTMLTextAreaElement) {
      if (typeof v === "string") item.value = v;
    }
  }
}

export function IntakeForm({
  token, intakeId, lang, businessName, initial, accessEmail, uploadsEnabled, facts = [], factsKey = "", askHandles = ["instagram", "tiktok", "facebook"], preview = false,
}: {
  token: string;
  intakeId: string;
  lang: IntakeLangCode;
  businessName: string;
  initial: Values;
  accessEmail: string | null;
  uploadsEnabled: boolean;
  /** What we found about the business, shown back on page 1 ("Is this right?"). Empty → no card. */
  facts?: { key: IntakeFactKey; value: string }[];
  /** Fingerprint of that card, posted back so a "Yes" is only counted for what they saw. */
  factsKey?: string;
  /** Accounts we couldn't find: the only ones page 2 asks for. */
  askHandles?: Array<"instagram" | "tiktok" | "facebook">;
  /** Team preview: nothing is saved on the device, uploaded or sent. */
  preview?: boolean;
}) {
  const C = intakeCopy(lang);
  const [state, formAction, pending] = useActionState<IntakeFormState, FormData>(submitIntakeAction, {});
  const [step, setStep] = useState(0);
  const [local, setLocal] = useState<Errors>({});
  const [restored, setRestored] = useState(false);
  const [uploads, setUploads] = useState<IntakeUploadedFile[]>([]);
  const [previewSent, setPreviewSent] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  /** Set by "Send now": this submit sends what's there instead of moving to the next page. */
  const sendingNow = useRef(false);
  const topRef = useRef<HTMLDivElement>(null);
  const stepRefs = useRef<Array<HTMLElement | null>>([]);
  const didRestore = useRef(false);
  const saveTimer = useRef<number | null>(null);
  const v = state.values ?? initial;
  const errors: Errors = { ...state.errors, ...local };
  const hasFacts = facts.length > 0;
  const [otherLang, setOtherLang] = useState(v.talkLang === "other");
  /** "Which language?" follows the picker, also after answers are put back or the form is reset. */
  const syncLang = useCallback(() => {
    const el = formRef.current?.elements.namedItem("talkLang");
    if (el instanceof HTMLSelectElement) setOtherLang(el.value === "other");
  }, []);

  const save = useCallback((nextStep?: number, nextUploads?: IntakeUploadedFile[]) => {
    const form = formRef.current;
    if (!form || preview) return;
    try {
      localStorage.setItem(storageKey(intakeId), JSON.stringify({ f: SAVE_VERSION, v: readValues(form), init: initial, fk: factsKey, step: nextStep ?? step, uploads: nextUploads ?? uploads, at: Date.now() }));
    } catch {
      /* private mode / storage full: the form still works, it just won't remember */
    }
  }, [intakeId, step, uploads, initial, factsKey, preview]);

  const saveSoon = () => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => save(), 400);
  };

  // JS is running: we validate per step ourselves (hidden steps would otherwise block native validation).
  useEffect(() => {
    if (formRef.current) formRef.current.noValidate = true;
    syncLang();
  }, [state.at, syncLang]);

  // Pick up where they left off (once, on first load).
  useEffect(() => {
    if (didRestore.current || preview) return;
    didRestore.current = true;
    try {
      const raw = localStorage.getItem(storageKey(intakeId));
      if (!raw) return;
      const saved = JSON.parse(raw) as { f?: number; v?: Values; init?: Values; fk?: string; step?: number; uploads?: IntakeUploadedFile[] };
      const current = saved.f === SAVE_VERSION;
      if (formRef.current && saved.v && typeof saved.v === "object") {
        const was = saved.init && typeof saved.init === "object" ? saved.init : {};
        const back: Values = {};
        for (const [k, val] of Object.entries(saved.v)) {
          // Something we filled in for them that they never touched: keep what our records say today (it may be newer).
          if (k in initial && val === (was[k] ?? "")) continue;
          // A "Yes, that's right" was for the card as it was then: if our details changed since, ask again.
          if ((k === "factsOk" || k === "factsFix") && saved.fk !== factsKey) continue;
          back[k] = val;
        }
        applyValues(formRef.current, back);
        syncLang();
      }
      if (Array.isArray(saved.uploads)) setUploads(saved.uploads.filter((u) => u && typeof u.url === "string").slice(0, 30));
      // Page numbers from the earlier 7-step form mean something else here, so that copy starts on page 1.
      if (current && typeof saved.step === "number") setStep(Math.min(LAST, Math.max(0, Math.floor(saved.step))));
      if (saved.v || saved.step) setRestored(true);
    } catch {
      /* unreadable storage: start fresh */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on first load
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

  /** "Send now": check page 1 (the only page with required answers), then send what's there. */
  const sendNow = () => {
    const form = formRef.current;
    const btn = submitRef.current;
    if (!form || !btn) return;
    sendingNow.current = true;
    if (typeof form.requestSubmit === "function") form.requestSubmit(btn);
    else btn.click();
  };

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
    if (n === 0) {
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
  const firstStep = hasFacts ? { title: C.steps[0].title, blurb: C.facts.intro } : C.aboutYou;
  const stepTitle = (i: number) => (i === 0 ? firstStep.title : C.steps[i].title);

  return (
    <div ref={topRef} className="scroll-mt-4">
      <Progress C={C} step={step} title={stepTitle(step)} />

      {restored && (
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
              syncLang();
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
        action={preview ? undefined : formAction}
        className="intake-form"
        onInput={saveSoon}
        onChange={saveSoon}
        onSubmit={(e) => {
          const now = sendingNow.current;
          sendingNow.current = false;
          // Enter on an earlier step moves forward instead of sending ("Send now" is the way to send early).
          if (step < LAST && !now) {
            e.preventDefault();
            if (checkStep(step)) go(step + 1);
            return;
          }
          // Only page 1 has required answers.
          if (!checkStep(0)) {
            e.preventDefault();
            if (step !== 0) go(0);
            return;
          }
          if (preview) {
            e.preventDefault();
            setPreviewSent(true);
            return;
          }
          save();
        }}
      >
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="lang" value={lang} />
        <input type="hidden" name="factsKey" value={factsKey} />
        <input type="hidden" name="uploads" value={JSON.stringify(uploads)} />
        {/* Honeypot: invisible to people, irresistible to bots. */}
        <div aria-hidden="true" className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden">
          <label>
            Leave this empty
            <input type="text" name="homepage" tabIndex={-1} autoComplete="off" defaultValue="" />
          </label>
        </div>

        {/* ── 1 · Is this right? (greeting on top, then what we found, then how to reach them) ── */}
        <Step
          C={C}
          index={0}
          current={step}
          refs={stepRefs}
          title={firstStep.title}
          blurb={firstStep.blurb}
          before={
            <div className="mb-7 space-y-2 rounded-2xl bg-surface-2 p-4">
              <p className="text-2xl font-semibold tracking-tight">{C.welcome.hi(businessName)}</p>
              <p className="text-[16px] leading-relaxed text-muted">{C.welcome.line}</p>
            </div>
          }
        >
          {hasFacts && (
            <>
              <FactsCard C={C} name={businessName} facts={facts} />
              <FactsCheck {...p} />
              <h3 className="mb-5 mt-9 border-t border-border pt-7 text-xl font-semibold tracking-tight">{C.contactTitle}</h3>
            </>
          )}
          <Fields {...p} names={["contactName"]} />
          <p className="mb-4 mt-6 rounded-xl bg-accent-soft px-4 py-3 text-[15px] leading-relaxed">{C.needContact}</p>
          <Fields {...p} names={["contactPhone", "contactEmail", "reachBy"]} />
          <div className="mt-6">
            <TalkLang C={C} v={v} onPick={(val) => setOtherLang(val === "other")} />
          </div>
          <div className="if-other-lang mt-6" data-on={otherLang}>
            <Fields {...p} names={["talkLangOther"]} />
          </div>
          <p className="intake-js mt-8 rounded-xl bg-info-soft px-4 py-3 text-[15px] leading-relaxed text-info">{C.common.thatsAll}</p>
        </Step>

        {/* ── 2 · Accounts & photos (optional) ── */}
        <Step C={C} index={1} current={step} refs={stepRefs} title={C.steps[1].title} blurb={C.steps[1].blurb} extra>
          {askHandles.length > 0 && (
            <div className="mb-10">
              <h3 className="text-xl font-semibold tracking-tight">{C.handles.title}</h3>
              <p className="mb-5 mt-1 text-[16px] leading-relaxed text-muted">{C.handles.intro}</p>
              <Fields {...p} names={askHandles} />
            </div>
          )}
          <Access C={C} v={v} accessEmail={accessEmail} first={askHandles.length === 0} />
          <div className="mt-10 border-t border-border pt-8">
            <Fields {...p} names={["mediaLink"]} />
            {uploadsEnabled && !preview && (
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
          </div>
        </Step>

        {/* ── 3 · How we'll work together (optional) ── */}
        <Step C={C} index={2} current={step} refs={stepRefs} title={C.steps[2].title} blurb={C.steps[2].blurb} extra>
          <Fields {...p} names={["promote", "postLangs", "creatorsOk"]} />
          <div className="if-creators mt-6">
            <Fields {...p} names={["creatorOffer"]} />
          </div>
          <div className="mt-6">
            <Fields {...p} names={["complaints", "anythingElse"]} />
          </div>
        </Step>

        {previewSent && (
          <p role="status" className="mt-6 rounded-xl bg-ok-soft px-4 py-3 text-[15px] text-ok">Preview only: nothing was sent. The owner would see the thank-you screen here.</p>
        )}

        <div className="sticky-actions mt-8">
          <div className="flex items-center gap-2 rounded-2xl border border-border bg-surface/95 p-2 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-surface/80">
            <button
              type="button"
              onClick={() => go(step - 1)}
              data-off={step === 0}
              className={cx(buttonClass("ghost"), "intake-js min-h-12 shrink-0 whitespace-nowrap px-3 text-[16px] data-[off=true]:hidden")}
            >
              <span aria-hidden>←</span> <span className="max-[379px]:sr-only">{C.common.back}</span>
            </button>
            {/* Sends what's there: only page 1 has required answers. */}
            <button
              type="button"
              disabled={pending}
              data-off={step === LAST}
              data-send-now=""
              onClick={sendNow}
              className={cx(buttonClass("secondary"), "intake-js ml-auto min-h-12 shrink-0 whitespace-nowrap px-4 text-[16px] data-[off=true]:hidden")}
            >
              {pending ? C.common.sending : C.common.sendNow}
            </button>
            <button
              type="button"
              data-off={step === LAST}
              onClick={() => checkStep(step) && go(step + 1)}
              className={cx(buttonClass("primary"), "intake-js min-h-12 shrink-0 whitespace-nowrap px-5 text-[16px] data-[off=true]:hidden")}
            >
              {C.common.next} →
            </button>
            <button
              ref={submitRef}
              type="submit"
              disabled={pending}
              data-off={step !== LAST}
              className={cx(buttonClass("primary"), "intake-submit ml-auto min-h-12 shrink-0 whitespace-nowrap px-5 text-[16px] data-[off=true]:hidden")}
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

function Progress({ C, step, title }: { C: IntakeCopy; step: number; title: string }) {
  return (
    <div className="intake-js mb-6" aria-live="polite">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="text-[16px] font-semibold">{title}</span>
        <span className="text-sm text-muted">{C.common.stepOf(step + 1, INTAKE_STEP_COUNT)}</span>
      </div>
      <div className="grid grid-cols-3 gap-1.5" aria-hidden>
        {C.steps.map((s, i) => (
          <span key={i} className={cx("h-2 rounded-full transition-colors", i <= step ? "bg-accent" : "bg-surface-2")} />
        ))}
      </div>
    </div>
  );
}

function Step({
  C, index, current, refs, title, blurb, extra, before, children,
}: {
  C: IntakeCopy; index: number; current: number; refs: React.RefObject<Array<HTMLElement | null>>; title: string; blurb: string;
  /** An optional page: framed as "Got one more minute?". */
  extra?: boolean; before?: ReactNode; children: ReactNode;
}) {
  return (
    <section
      ref={(el) => { refs.current[index] = el; }}
      data-off={index !== current}
      aria-labelledby={`intake-step-${index}`}
      className="intake-step data-[off=true]:hidden"
    >
      {before}
      <header className="mb-6">
        {extra && <p className="mb-1 text-[15px] font-semibold text-accent">{C.common.oneMoreMinute}</p>}
        <h2 id={`intake-step-${index}`} tabIndex={-1} className="text-xl font-semibold tracking-tight outline-none">
          <span className="intake-nojs mr-1 hidden text-muted">{index + 1}.</span>
          {title}
        </h2>
        <p className="mt-1 text-[16px] text-muted">{blurb}</p>
        {extra && <p className="mt-2 text-[15px] text-muted">💡 {C.common.skip}</p>}
      </header>
      {children}
    </section>
  );
}

/** What we found about the business, as plain text: the name, then only the facts we have. */
function FactsCard({ C, name, facts }: { C: IntakeCopy; name: string; facts: { key: IntakeFactKey; value: string }[] }) {
  const rows: Array<{ key: string; label: string; value: string }> = [
    { key: "name", label: C.facts.labels.name, value: name },
    ...facts.map((f) => ({ key: f.key, label: C.facts.labels[f.key], value: f.value })),
  ];
  return (
    <dl data-intake-facts="" className="divide-y divide-border rounded-2xl border border-border">
      {rows.map((r) => (
        <div key={r.key} className="flex gap-3 px-4 py-2.5">
          <dt className="w-[5.5rem] shrink-0 pt-px text-[15px] leading-snug text-muted">{r.label}</dt>
          <dd data-fact={r.key} className="min-w-0 flex-1 whitespace-pre-line break-words text-[16px] font-medium leading-snug">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** One tap: "Yes, that's right" or "Something's off" — which opens the one text box (pure CSS, see the page's style). */
function FactsCheck({ C, v, errors, clearLocal }: Common) {
  const labels = C.options.factsOk as Record<string, string>;
  const cur = typeof v.factsOk === "string" ? v.factsOk : "";
  return (
    <div className="mt-4">
      <fieldset>
        <legend className="sr-only">{C.fields.factsOk.label}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {CHOICE_FIELDS.factsOk.values.map((val) => (
            <label key={val} className={cx(pill, "rounded-xl font-medium")}>
              <input type="radio" name="factsOk" value={val} defaultChecked={cur === val} className="shrink-0" />
              <span>{labels[val]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="if-facts-off mt-4">
        <Text C={C} v={v} errors={errors} clearLocal={clearLocal} name="factsFix" />
      </div>
    </div>
  );
}

/** The language to talk in: starts from the language the form is read in; one tap to change. */
function TalkLang({ C, v, onPick }: { C: IntakeCopy; v: Values; onPick: (value: string) => void }) {
  const labels = C.options.talkLang as Record<string, string>;
  const cur = typeof v.talkLang === "string" ? v.talkLang : "";
  return (
    <div>
      <label htmlFor="f-talkLang" className="mb-2 block text-[16px] font-medium leading-snug">{C.fields.talkLang.label}</label>
      <select id="f-talkLang" name="talkLang" defaultValue={cur} onChange={(e) => onPick(e.currentTarget.value)} className="input !min-h-12 !text-[16px]">
        {!cur && <option value="" />}
        {CHOICE_FIELDS.talkLang.values.map((val) => (
          <option key={val} value={val}>{labels[val]}</option>
        ))}
      </select>
    </div>
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

/**
 * "How to give us access": Meta + Google each get Done / I'll need help, with the plain numbered steps folded
 * under "Show me how" (a <details>, so it works without JavaScript). TikTok is one line: we do it on the call.
 * Never asks for passwords.
 */
function Access({ C, v, accessEmail, first }: { C: IntakeCopy; v: Values; accessEmail: string | null; first?: boolean }) {
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
  const radios = (name: "accessMeta" | "accessGoogle") => {
    const cur = typeof v[name] === "string" ? (v[name] as string) : "";
    const labels = C.options[name] as Record<string, string>;
    return (
      <fieldset className="mt-3">
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
  const howTo = (list: readonly string[]) => (
    <details className="group mt-2">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-[16px] font-medium text-accent [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="transition-transform group-open:rotate-90">›</span>
        {A.showHow}
      </summary>
      <ol className="mt-2 space-y-2.5">
        {list.map((s, i) => (
          <li key={i} className="flex gap-3 text-[16px] leading-relaxed">
            <span aria-hidden className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-sm font-semibold">{i + 1}</span>
            <span className="min-w-0">{fill(s)}</span>
          </li>
        ))}
      </ol>
    </details>
  );

  return (
    <div className={first ? undefined : "border-t border-border pt-8"}>
      <h3 className="text-xl font-semibold tracking-tight">{A.title}</h3>
      <p className="mt-1 text-[16px] leading-relaxed text-muted">{A.intro}</p>
      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-surface-2 px-4 py-3">
        <span className="text-[15px] text-muted">{A.emailLabel}</span>
        <span className="min-w-0 break-all text-[17px] font-semibold">{email}</span>
        {accessEmail && <CopyEmail C={C} email={accessEmail} />}
      </div>

      <div className="mt-5 space-y-4">
        <div className="rounded-2xl border border-border p-4">
          <h4 className="text-[17px] font-semibold">{A.meta.title}</h4>
          {howTo(A.meta.steps)}
          {radios("accessMeta")}
        </div>
        <div className="rounded-2xl border border-border p-4">
          <h4 className="text-[17px] font-semibold">{A.google.title}</h4>
          {howTo(A.google.steps)}
          {radios("accessGoogle")}
        </div>
        <p className="rounded-2xl border border-border p-4 text-[16px] leading-relaxed">
          <span className="font-semibold">{A.tiktok.title}: </span>
          {A.tiktok.body}
        </p>
      </div>
      <p className="mt-4 flex gap-2 rounded-xl border border-warn/40 bg-warn-soft px-4 py-3 text-[15px] font-medium text-warn">
        <span aria-hidden>🔒</span>
        <span>{C.common.neverPasswords}</span>
      </p>
      <p className="mt-3 text-[15px] text-muted">💡 {A.tip}</p>
    </div>
  );
}
