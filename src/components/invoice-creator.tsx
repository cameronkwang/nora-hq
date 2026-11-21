"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  PAY_WAYS,
  PAY_WAY_LABEL,
  PDF_LETTERS,
  SETUP_PREFILL,
  addDaysYmd,
  centsToDollarsInput,
  checkPayWays,
  creatorDefaultsLine,
  customerNameKey,
  daysBetween,
  filterBillTo,
  formatCents,
  invoiceTotals,
  isQuantity,
  isYmd,
  lineFromSavedItem,
  oneLineAddress,
  parseDollars,
  pdfPrintsEmpty,
  pdfUnprintable,
  readyItems,
  sortPayWays,
  type BillToOption,
  type CreatorEdit,
  type CreatorLine,
  type InvoiceCreatorContext,
  type InvoiceDone,
  type InvoiceItem,
  type InvoicePrefill,
  type LastInvoice,
  type PayWay,
  type SavedItem,
} from "@/lib/invoices-types";
import type { IntakeLang } from "@/lib/schema";
import { today as todayNY } from "@/lib/dates";
import { lastInvoiceAction, makePdfAction, saveDraftAction, setNextNumberAction, updateInvoiceAction } from "@/app/(app)/invoices/actions";
import type { QuickInvoiceInputT } from "@/lib/ops-invoices";
import { InvoiceDoneView, canShareFiles } from "./invoice-done";
import { Status, buttonClass, cx } from "./ui";

/**
 * The fast creator (/invoices/new, docs/invoicing.md "The fast creator"): one screen, phone first. Bill to (a
 * typeahead over customers, managed businesses and deal businesses), saved lines as one-tap chips, a custom line,
 * live totals, the defaults as one quiet line ("Due on receipt · Zelle · #0000170", each part tappable), More, and
 * ONE focal button: Make PDF (Cmd/Ctrl+Enter). It saves and finalizes in one server action and turns into the done
 * state. Plain React and the pure helpers only: no date, form or PDF library is loaded here (the PDF is made on the
 * server), so the page is interactive as soon as it paints.
 *
 * `edit` reuses the same screen to change a finalized invoice that isn't paid (everything but the customer).
 */

type Line = { key: number; description: string; quantity: string; amount: string; savedItemId: string | null };
type Panel = null | "due" | "pay" | "number";
type ErrField = "billTo" | "lines" | "pay" | "setup" | "zelle" | "due" | "discount" | "form";
type Err = { field: ErrField; message: string; lineKey?: number };

export type { CreatorEdit };

/** One id per form as it was sent: pressing Make PDF again with the same form returns the invoice the first press made. */
function newRequestId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

let seq = 1;
const nextKey = () => seq++;

const toLine = (l: CreatorLine): Line => ({
  key: nextKey(),
  description: l.description,
  quantity: String(l.quantity || 1),
  amount: centsToDollarsInput(l.unitCents),
  savedItemId: l.savedItemId,
});

const LANG_OPTIONS: Array<{ value: "" | IntakeLang; label: string }> = [
  { value: "", label: "The customer's language" },
  { value: "en", label: "English" },
  { value: "zh-Hans", label: "简体中文" },
  { value: "zh-Hant", label: "繁體中文" },
];

/** A blank creator (after "New invoice" in the done state): today, due on receipt, the ways ticked in Settings (Zelle unless she chose others), no lines. */
export function blankPrefill(ctx: Pick<InvoiceCreatorContext, "today" | "settings" | "defaultPayWays">): InvoicePrefill {
  return {
    billTo: null, newCustomer: null, lines: [], issueDate: ctx.today, dueDate: addDaysYmd(ctx.today, ctx.settings.termsDays), payWays: [...ctx.defaultPayWays],
    payNote: null, notes: ctx.settings.footer, lang: null, dealId: null, contractId: null, contractPart: null, draftId: null, source: "blank", note: null,
  };
}

/** Lines that are typed far enough to count in the live total (a line still missing its amount counts as 0). */
function looseItems(lines: Line[]): InvoiceItem[] {
  const out: InvoiceItem[] = [];
  for (const l of lines) {
    let cents: number | null = null;
    try {
      cents = parseDollars(l.amount);
    } catch {
      cents = null;
    }
    const q = Number(l.quantity);
    if (cents != null && isQuantity(q)) out.push({ description: l.description, quantity: q, unitCents: cents });
  }
  return out;
}

function creatorLines(lines: Line[]): { lines: CreatorLine[]; bad: { key: number; message: string } | null } {
  const out: CreatorLine[] = [];
  for (const l of lines) {
    let unitCents: number | null = null;
    try {
      unitCents = parseDollars(l.amount);
    } catch (e) {
      return { lines: [], bad: { key: l.key, message: e instanceof Error ? e.message : "Check the amount." } };
    }
    const quantity = Number(l.quantity || "1");
    out.push({ description: l.description, quantity: Number.isFinite(quantity) ? quantity : 0, unitCents, savedItemId: l.savedItemId });
  }
  return { lines: out, bad: null };
}

export function InvoiceCreator({ ctx, edit, initialDone }: { ctx: InvoiceCreatorContext; edit?: CreatorEdit; initialDone?: InvoiceDone | null }) {
  const router = useRouter();
  const uid = useId();
  const avail = ctx.payWays;
  const saved = ctx.savedItems;

  const [prefill, setPrefill] = useState<InvoicePrefill>(ctx.prefill);
  const p = prefill;

  /* Bill to */
  const [who, setWho] = useState(p.billTo?.name ?? p.newCustomer?.name ?? "");
  const [picked, setPicked] = useState<BillToOption | null>(p.billTo);
  const [isNew, setIsNew] = useState(!p.billTo && !!p.newCustomer);
  const [address, setAddress] = useState(p.billTo?.address ?? p.newCustomer?.billingAddress ?? "");
  const [addressOpen, setAddressOpen] = useState(!p.billTo && !!p.newCustomer);
  const [contactName, setContactName] = useState(p.newCustomer?.contactName ?? "");
  const [email, setEmail] = useState(p.newCustomer?.email ?? "");
  const [listOpen, setListOpen] = useState(false);
  const [active, setActive] = useState(0);
  // A picked customer's last invoice when it didn't come with the page (see `last` below), keyed by the option.
  const [fetched, setFetched] = useState<{ key: string; value: LastInvoice | null } | null>(null);
  /** She tapped Same as last time while it was still loading: it is applied the moment it arrives. */
  const wantLast = useRef(false);

  /* Lines */
  const [lines, setLines] = useState<Line[]>(() => p.lines.map(toLine));
  const [newDesc, setNewDesc] = useState("");
  const [newAmount, setNewAmount] = useState("");

  /* Defaults and More */
  const [issueDateSet, setIssueDate] = useState(p.issueDate);
  const [dueDateSet, setDueDate] = useState(p.dueDate);
  // The day this form was started, and whether she set a date herself. A creator left open past midnight (or for
  // days) still dates the invoice the day it is MADE: untouched default dates follow today (in the app's timezone).
  const [formDay, setFormDay] = useState(ctx.today);
  const [datesTouched, setDatesTouched] = useState(false);
  const [nowDay, setNowDay] = useState(ctx.today);
  /** Days until due picked with the Due chips while the dates still follow today (null: the prefill's). */
  const [terms, setTerms] = useState<number | null>(null);
  const [payWays, setPayWays] = useState<PayWay[]>(sortPayWays(p.payWays));
  const [payNote, setPayNote] = useState(p.payNote ?? "");
  const [panel, setPanel] = useState<Panel>(null);
  const [nextNumber, setNextNumber] = useState(ctx.nextNumber);
  const [numberText, setNumberText] = useState(String(Number(ctx.nextNumber) || ""));
  const [numberMsg, setNumberMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [discount, setDiscount] = useState(p.discountCents ? centsToDollarsInput(p.discountCents) : "");
  const [discountMode, setDiscountMode] = useState<"$" | "%">("$");
  const [discountLabel, setDiscountLabel] = useState(p.discountLabel ?? "");
  const [notes, setNotes] = useState(p.notes ?? "");
  const [privateNotes, setPrivateNotes] = useState(p.privateNotes ?? "");
  const [lang, setLang] = useState<"" | IntakeLang>(p.lang ?? "");

  /* The one-time ask */
  const [setup, setSetup] = useState({ fromName: SETUP_PREFILL.fromName as string, fromAddress: "", zelle: "" });

  /* Submit */
  const [busy, setBusy] = useState<null | "pdf" | "draft">(null);
  const [err, setErr] = useState<Err | null>(null);
  const [done, setDone] = useState<InvoiceDone | null>(initialDone ?? null);

  useEffect(() => setNextNumber(ctx.nextNumber), [ctx.nextNumber]);
  // The shortcut hint on Make PDF: ⌘↵ on a Mac, Ctrl ↵ elsewhere (hidden on touch screens).
  const [mac, setMac] = useState(true);
  useEffect(() => setMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)), []);

  const whoRef = useRef<HTMLInputElement>(null);
  const firstChipRef = useRef<HTMLButtonElement>(null);
  const sameRef = useRef<HTMLButtonElement>(null);
  const newDescRef = useRef<HTMLInputElement>(null);
  const newAmountRef = useRef<HTMLInputElement>(null);
  const makeRef = useRef<HTMLButtonElement>(null);
  const doneHeading = useRef<HTMLHeadingElement>(null);
  const amountRefs = useRef(new Map<number, HTMLInputElement>());
  const [focusKey, setFocusKey] = useState<number | null>(null);

  // Focus starts in Bill to (unless the prefill already picked who it's for: then on the first line still to type).
  useEffect(() => {
    if (done || edit) return;
    if (!p.billTo && !p.newCustomer) whoRef.current?.focus();
    else {
      const empty = lines.find((l) => !l.amount.trim());
      if (empty) setFocusKey(empty.key);
      else if (!lines.length) firstChipRef.current?.focus();
      // Everything is filled in already (a draft, a contract): Make PDF is the next thing, one key away.
      else makeRef.current?.focus({ preventScroll: true });
    }
    // Only when the creator opens or is reset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill]);

  useEffect(() => {
    if (focusKey == null) return;
    const el = amountRefs.current.get(focusKey);
    if (el) {
      el.focus();
      el.select();
    }
    setFocusKey(null);
  }, [focusKey, lines]);

  useEffect(() => {
    if (done) doneHeading.current?.focus();
  }, [done]);

  // "Same as last time": the picked customer's last invoice. It comes with the page for a prefilled customer and for
  // the most recently billed ones (no round trip); for anyone else it is fetched the moment they are picked.
  const last: LastInvoice | null | "loading" =
    !picked?.customerId || !picked.hasLast || edit
      ? null
      : p.last !== undefined && p.billTo?.key === picked.key
        ? p.last
        : picked.last !== undefined
          ? picked.last
          : fetched?.key === picked.key
            ? fetched.value
            : "loading";
  const applyLastRef = useRef<(l: LastInvoice) => void>(() => {});
  useEffect(() => {
    wantLast.current = false;
    if (!picked?.customerId || !picked.hasLast || edit) return;
    if ((p.last !== undefined && p.billTo?.key === picked.key) || picked.last !== undefined) return;
    let live = true;
    const key = picked.key;
    lastInvoiceAction(picked.customerId)
      .then((r) => {
        if (!live) return;
        setFetched({ key, value: r });
        if (r && wantLast.current) applyLastRef.current(r);
        // Nothing to repeat after all: the button is gone, so the first saved line is next.
        else if (!r) requestAnimationFrame(() => (!document.activeElement || document.activeElement === document.body) && firstChipRef.current?.focus());
        wantLast.current = false;
      })
      .catch(() => live && setFetched({ key, value: null }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked, edit]);

  // Today, as the app's timezone has it: checked when the tab comes back and again when Make PDF is pressed.
  useEffect(() => {
    const tick = () => setNowDay(todayNY());
    tick();
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.removeEventListener("focus", tick);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);
  // The dates follow today while she hasn't set one herself and the form started on its default date (not an edit,
  // not a draft that carries its own date).
  const datesFollowToday = !edit && !datesTouched && p.issueDate === formDay && isYmd(p.issueDate) && isYmd(p.dueDate);
  /** The dates the invoice will carry if it is made on `day`: hers once she set one, else the defaults as of that day. */
  const datesOn = (day: string) => {
    if (!datesFollowToday) return { issue: issueDateSet, due: dueDateSet };
    const issue = day > formDay ? day : formDay;
    const days = terms ?? Math.max(0, daysBetween(p.issueDate, p.dueDate));
    // A deal's agreed due date is a date, not a number of days: it stays (never before the invoice date).
    const fixedDue = terms == null && p.source === "deal" && days > 0;
    return { issue, due: fixedDue ? (p.dueDate >= issue ? p.dueDate : issue) : addDaysYmd(issue, days) };
  };
  const { issue: issueDate, due: dueDate } = datesOn(nowDay);

  /* ───────── derived ───────── */

  const options = useMemo(() => (listOpen ? filterBillTo(ctx.billTo, who, 8) : []), [ctx.billTo, who, listOpen]);
  const whoKey = customerNameKey(who);
  const exact = whoKey ? ctx.billTo.find((o) => o.nameKey === whoKey) ?? null : null;
  const offerNew = listOpen && !!who.trim() && !exact;
  const optionCount = options.length + (offerNew ? 1 : 0);

  // The same lines Make PDF will send: a custom line typed but not added yet counts too.
  const pendingLine: Line | null = newDesc.trim() || newAmount.trim() ? { key: -1, description: newDesc, quantity: "1", amount: newAmount, savedItemId: null } : null;
  const items = looseItems(pendingLine ? [...lines, pendingLine] : lines);
  const subtotal = invoiceTotals(items).subtotalCents;
  let discountCents = 0;
  let discountError = "";
  try {
    if (discountMode === "$") discountCents = parseDollars(discount) ?? 0;
    else {
      const pct = discount.trim() ? Number(discount.replace(/[%\s]/g, "")) : 0;
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) discountError = "A percent from 0 to 100.";
      else discountCents = Math.round((subtotal * pct) / 100);
    }
  } catch (e) {
    discountError = e instanceof Error ? e.message : "Check the discount.";
  }
  const totals = invoiceTotals(items, discountCents);

  // What the PDF can't print (it has English letters only): said under the field before Make PDF, never found out after.
  const billName = edit ? "" : (picked ?? (!isNew ? exact : null))?.name ?? who;
  const nameEmpty = !edit && pdfPrintsEmpty(billName);
  const nameLeftOut = edit ? "" : pdfUnprintable(billName);
  const lineTexts = [...lines.map((l) => l.description), newDesc];
  const linesLeftOut = pdfUnprintable(lineTexts.join(" "));
  const notesLeftOut = pdfUnprintable(notes);

  const setupMissing = edit ? [] : ctx.setupMissing;
  const zelleTyped = setupMissing.includes("zelle") && !!setup.zelle.trim();
  const availNow = useMemo(() => (zelleTyped ? { ...avail, zelle: { ok: true, why: null } } : avail), [avail, zelleTyped]);
  const defaults = creatorDefaultsLine({ issueDate, dueDate, payWays, nextNumber: edit ? edit.number : nextNumber });

  /* ───────── Bill to ───────── */

  function pick(o: BillToOption) {
    setPicked(o);
    setWho(o.name);
    setIsNew(false);
    setAddress(o.address ?? "");
    setAddressOpen(false);
    setListOpen(false);
    if (err?.field === "billTo") setErr(null);
    // Next: "Same as last time" if they have past invoices, else the first saved line.
    requestAnimationFrame(() => ((o.hasLast && o.customerId && o.last !== null ? sameRef.current : null) ?? firstChipRef.current)?.focus());
  }

  function pickNew() {
    setPicked(null);
    setIsNew(true);
    setAddressOpen(true);
    setListOpen(false);
    if (err?.field === "billTo") setErr(null);
    requestAnimationFrame(() => document.getElementById(`${uid}-addr`)?.focus());
  }

  function onWhoKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setListOpen(true);
      if (optionCount) setActive((a) => (a + (e.key === "ArrowDown" ? 1 : optionCount - 1)) % optionCount);
    } else if (e.key === "Enter" && !(e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (listOpen && active < options.length && options[active]) pick(options[active]);
      else if (exact) pick(exact);
      else if (who.trim()) pickNew();
    } else if (e.key === "Escape" && listOpen) {
      e.preventDefault();
      setListOpen(false);
    }
  }

  /* ───────── Lines ───────── */

  function addSaved(item: SavedItem) {
    const l = toLine(lineFromSavedItem(item));
    setLines((ls) => [...ls, l]);
    if (err?.field === "lines") setErr(null);
    // Typed each time (Food Stipend): straight into its amount.
    if (item.unitCents == null) setFocusKey(l.key);
  }

  function applyLast(given?: LastInvoice) {
    const from = given ?? last;
    if (from === "loading") {
      wantLast.current = true; // applied the moment it arrives (the tap is never lost)
      return;
    }
    if (!from) return;
    const ls = from.lines.map(toLine);
    setLines(ls);
    setPayWays(sortPayWays(from.payWays));
    setPayNote(from.payNote ?? "");
    if (from.notes) setNotes(from.notes);
    if (from.discountCents > 0) {
      setDiscountMode("$");
      setDiscount(centsToDollarsInput(from.discountCents));
      setDiscountLabel(from.discountLabel ?? "");
    }
    const empty = ls.find((l) => !l.amount.trim());
    if (empty) setFocusKey(empty.key);
    else requestAnimationFrame(() => makeRef.current?.focus());
  }
  applyLastRef.current = applyLast;

  const patchLine = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const removeLine = (key: number) => setLines((ls) => ls.filter((l) => l.key !== key));

  function addCustom() {
    const description = newDesc.trim();
    if (!description && !newAmount.trim()) return false;
    let cents: number | null = null;
    try {
      cents = parseDollars(newAmount);
    } catch (e) {
      setErr({ field: "lines", message: e instanceof Error ? e.message : "Check the amount." });
      return false;
    }
    if (!description) {
      setErr({ field: "lines", message: "Describe the line." });
      newDescRef.current?.focus();
      return false;
    }
    setLines((ls) => [...ls, { key: nextKey(), description, quantity: "1", amount: centsToDollarsInput(cents), savedItemId: null }]);
    setNewDesc("");
    setNewAmount("");
    if (err?.field === "lines") setErr(null);
    return true;
  }

  /** Enter moves on: the next amount still empty, else the custom line, else Make PDF. */
  function onLineEnter(e: KeyboardEvent<HTMLInputElement>, key: number) {
    if (e.key !== "Enter" || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    const idx = lines.findIndex((l) => l.key === key);
    const next = lines.slice(idx + 1).find((l) => !l.amount.trim()) ?? lines.find((l) => l.key !== key && !l.amount.trim());
    if (next) setFocusKey(next.key);
    else makeRef.current?.focus();
  }

  /* ───────── Pay ways ───────── */

  function toggleWay(w: PayWay, on: boolean) {
    setPayWays((ws) => {
      const next = on ? sortPayWays([...ws, w]) : ws.filter((x) => x !== w);
      return next.length ? next : ws; // at least one way
    });
    if (err?.field === "pay") setErr(null);
  }

  async function saveNumber() {
    const n = Number(numberText.replace(/[#\s,]/g, ""));
    if (!Number.isInteger(n) || n < 1) return setNumberMsg({ ok: false, text: "Use a whole number, like 170." });
    const r = await setNextNumberAction(n).catch(() => ({ ok: false as const, error: "Couldn't save it. Try again." }));
    if (!r.ok) return setNumberMsg({ ok: false, text: r.error });
    setNextNumber(r.next);
    setNumberText(String(Number(r.next)));
    setNumberMsg({ ok: true, text: Number(r.next) === n ? `The next invoice is ${r.next}.` : `${String(n).padStart(7, "0")} is already used, so the next is ${r.next}.` });
  }

  /* ───────── Submit ───────── */

  function build(forPdf: boolean): QuickInvoiceInputT | null {
    setErr(null);
    // Who
    let billTo: QuickInvoiceInputT["billTo"] | null = null;
    const addr = address.trim() || null;
    const target = picked ?? (!isNew ? exact : null);
    if (edit) billTo = { kind: "customer", id: "edit" };
    else if (target) {
      // Always what the address box shows: an address that came from the business's public facts is printed and saved
      // on the customer (the server writes it only when it differs from the one they already have).
      billTo = { kind: target.kind, id: target.id, address: addr };
    } else if (who.trim()) {
      billTo = { kind: "new", name: who.trim(), address: addr, contactName: contactName.trim() || null, email: email.trim() || null, lang: lang || null };
    }
    if (!billTo) {
      setErr({ field: "billTo", message: "Who is this invoice for?" });
      whoRef.current?.focus();
      return null;
    }
    // A name the PDF would print empty (Chinese only) is stopped here, not printed as "Customer".
    if (forPdf && nameEmpty) {
      setErr({ field: "billTo", message: target ? PDF_LETTERS.customer(target.name) : PDF_LETTERS.name });
      whoRef.current?.focus();
      return null;
    }
    // Lines
    const cl = creatorLines(lines);
    if (cl.bad) {
      setErr({ field: "lines", message: cl.bad.message, lineKey: cl.bad.key });
      setFocusKey(cl.bad.key);
      return null;
    }
    // A custom line typed but not added yet counts too.
    if (newDesc.trim() || newAmount.trim()) {
      try {
        const cents = parseDollars(newAmount);
        cl.lines.push({ description: newDesc.trim(), quantity: 1, unitCents: cents, savedItemId: null });
      } catch (e) {
        setErr({ field: "lines", message: e instanceof Error ? e.message : "Check the amount." });
        newAmountRef.current?.focus();
        return null;
      }
    }
    const ready = readyItems(cl.lines);
    if (ready.error != null) {
      setErr({ field: "lines", message: ready.error });
      const empty = lines.find((l) => !l.amount.trim());
      if (empty) setFocusKey(empty.key);
      else if (!lines.length) firstChipRef.current?.focus();
      return null;
    }
    if (forPdf || edit) {
      const blank = ready.items.find((i) => pdfPrintsEmpty(i.description));
      if (blank) {
        const at = lines.find((l) => l.description.trim() === blank.description);
        setErr({ field: "lines", message: PDF_LETTERS.line(blank.description), lineKey: at?.key });
        return null;
      }
    }
    if (discountError) {
      setErr({ field: "discount", message: discountError });
      return null;
    }
    // Dates: as of this moment (the screen may have been open since yesterday).
    const { issue: issueDate, due: dueDate } = datesOn(todayNY());
    if (!isYmd(issueDate) || !isYmd(dueDate)) {
      setErr({ field: "due", message: "Pick the invoice date and the due date." });
      setPanel("due");
      return null;
    }
    if (dueDate < issueDate) {
      setErr({ field: "due", message: "The due date can't be before the invoice date." });
      setPanel("due");
      return null;
    }
    // Ways to pay
    if (setupMissing.includes("zelle") && payWays.includes("zelle") && !setup.zelle.trim()) {
      setErr({ field: "zelle", message: "Add your Zelle number (or choose another way to pay)." });
      document.getElementById(`${uid}-zelle`)?.focus();
      return null;
    }
    const payErr = checkPayWays(payWays, payNote, availNow);
    if (payErr) {
      setErr({ field: "pay", message: payErr });
      setPanel("pay");
      return null;
    }
    const setupIn = setupMissing.length
      ? {
          ...(setupMissing.includes("fromName") && setup.fromName.trim() ? { fromName: setup.fromName.trim() } : {}),
          ...(setupMissing.includes("fromAddress") && setup.fromAddress.trim() ? { fromAddress: setup.fromAddress.trim() } : {}),
          ...(setupMissing.includes("zelle") && setup.zelle.trim() ? { zelle: setup.zelle.trim() } : {}),
        }
      : null;
    return {
      billTo,
      issueDate,
      dueDate,
      items: ready.items,
      // Always a number: 0 clears a draft's old discount.
      discountCents: Math.min(discountCents, invoiceTotals(ready.items).subtotalCents),
      discountLabel: discountCents > 0 ? discountLabel.trim() || (discountMode === "%" && discount.trim() ? `${discount.replace(/[%\s]/g, "")}%` : null) : null,
      notes: notes.trim() || null,
      privateNotes: privateNotes.trim() || null,
      lang: lang || null,
      payWays,
      payNote: payWays.includes("custom") ? payNote.trim() || null : null,
      dealId: p.dealId,
      contractId: p.contractId,
      draftId: p.draftId,
      setup: setupIn && Object.keys(setupIn).length ? setupIn : null,
    };
  }

  // The id Make PDF sends with the form: the same form sent again (after "Couldn't reach Nora HQ") gets the same id,
  // so the server returns the invoice the first press made; a form she changed since gets a new one.
  const request = useRef<{ form: string; id: string } | null>(null);

  async function makePdf() {
    if (busy) return;
    const input = build(true);
    if (!input) return;
    if (edit) return saveEdit(input);
    setBusy("pdf");
    const form = JSON.stringify(input);
    if (request.current?.form !== form) request.current = { form, id: newRequestId() };
    const t0 = performance.now();
    // A phone that can share files gets the PDF back with the answer: Share PDF is ready with no second round trip.
    const r = await makePdfAction({ ...input, requestId: request.current.id }, { pdf: canShareFiles() }).catch(() => ({ ok: false as const, error: "Couldn't reach Nora HQ. Check the connection and try again." }));
    try {
      performance.measure("invoice:make-pdf", { start: t0, end: performance.now() });
    } catch {
      /* no timing API */
    }
    setBusy(null);
    if (!r.ok) {
      setErr({ field: "form", message: r.error });
      return;
    }
    request.current = null;
    setDone(r.done);
    // A reload shows the same done state; "New invoice" starts again. The address keeps what it had and gains ?done=,
    // so the page's key stays the same and the live refresh never remounts this screen (Share stays ready, the message
    // language stays chosen). Deferred a tick: changing the address while the action is settling makes Next refresh.
    const doneId = r.done.id;
    window.setTimeout(() => {
      try {
        const u = new URL(window.location.href);
        u.searchParams.set("done", doneId);
        window.history.replaceState(null, "", `${u.pathname}${u.search}`);
      } catch {
        /* the done state still shows */
      }
    }, 0);
    window.scrollTo({ top: 0 });
  }

  async function saveDraft() {
    if (busy || edit) return;
    const input = build(false);
    if (!input) return;
    setBusy("draft");
    const r = await saveDraftAction(input).catch(() => ({ ok: false as const, error: "Couldn't reach Nora HQ. Try again." }));
    if (!r.ok) {
      setBusy(null);
      setErr({ field: "form", message: r.error });
      return;
    }
    router.push(`/invoices/${encodeURIComponent(r.id)}?saved=draft`);
  }

  async function saveEdit(input: QuickInvoiceInputT) {
    if (!edit) return;
    setBusy("pdf");
    const r = await updateInvoiceAction(edit.id, {
      issueDate: input.issueDate, dueDate: input.dueDate, items: input.items, discountCents: input.discountCents ?? 0, discountLabel: input.discountLabel,
      notes: input.notes, privateNotes: input.privateNotes, lang: input.lang, payWays: input.payWays, payNote: input.payNote,
    }).catch(() => ({ ok: false as const, error: "Couldn't reach Nora HQ. Try again." }));
    if (!r.ok) {
      setBusy(null);
      setErr({ field: "form", message: r.error });
      return;
    }
    router.push(`/invoices/${encodeURIComponent(edit.id)}?saved=edit`);
  }

  /** A blank form again (after the done state). */
  function resetForm() {
    // Today as it is NOW: the done state may have been open since last week.
    const day = todayNY();
    const blank = blankPrefill({ ...ctx, today: day });
    setFormDay(day);
    setNowDay(day);
    setDatesTouched(false);
    setTerms(null);
    request.current = null;
    setDone(null);
    setPrefill(blank);
    setWho("");
    setPicked(null);
    setIsNew(false);
    setAddress("");
    setAddressOpen(false);
    setContactName("");
    setEmail("");
    setLines([]);
    setNewDesc("");
    setNewAmount("");
    setIssueDate(blank.issueDate);
    setDueDate(blank.dueDate);
    setPayWays(sortPayWays(blank.payWays));
    setPayNote("");
    setPanel(null);
    setDiscount("");
    setDiscountLabel("");
    setNotes(blank.notes ?? "");
    setPrivateNotes("");
    setLang("");
    setErr(null);
  }

  function startNew() {
    resetForm();
    // Fresh numbers, Bill to list and settings from the server (the page is dynamic).
    router.replace("/invoices/new");
  }

  // The done state lives at …?done=<id>. When she leaves it for a plain New invoice (the sidebar, the list's button),
  // the page keeps this screen mounted (the same key), so the form starts again here.
  const urlDone = useSearchParams().get("done");
  const hadUrlDone = useRef(!!urlDone);
  const resetRef = useRef(resetForm);
  resetRef.current = resetForm;
  useEffect(() => {
    if (hadUrlDone.current && !urlDone && done) resetRef.current();
    hadUrlDone.current = !!urlDone;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlDone]);

  // Cmd/Ctrl+Enter makes the PDF from anywhere on the screen (not only from inside a field).
  const makeFn = useRef(makePdf);
  makeFn.current = makePdf;
  useEffect(() => {
    if (done) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Enter" || !(e.metaKey || e.ctrlKey) || e.defaultPrevented || document.querySelector("dialog[open]")) return;
      e.preventDefault();
      void makeFn.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [done]);

  if (done) {
    return (
      <div className="inv-creator">
        <InvoiceDoneView done={done} onNew={startNew} headingRef={doneHeading} />
      </div>
    );
  }

  const errFor = (f: ErrField) => (err?.field === f ? err.message : null);
  const listId = `${uid}-billto`;

  return (
    <div className="inv-creator">
      {p.note && <p className="inv-from-note meta">{p.note}</p>}

      {/* ───────── Bill to ───────── */}
      <div className="inv-field inv-billto">
        <label htmlFor={`${uid}-who`} className="inv-label">Bill to</label>
        {edit ? (
          <div className="min-w-0">
            <p className="inv-who-static">{edit.customerName}</p>
            {edit.customerAddress && <p className="meta">{oneLineAddress(edit.customerAddress)}</p>}
            <p className="hint">The customer can&apos;t change on a finalized invoice.</p>
          </div>
        ) : (
          <div className="min-w-0">
            <div className="inv-combo">
              <input
                id={`${uid}-who`}
                ref={whoRef}
                className="input inv-who"
                role="combobox"
                aria-expanded={listOpen && optionCount > 0}
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={listOpen && optionCount ? `${listId}-${active}` : undefined}
                aria-invalid={!!errFor("billTo")}
                aria-describedby={errFor("billTo") ? `${uid}-who-err` : undefined}
                value={who}
                placeholder="Business or name"
                autoComplete="off"
                autoCapitalize="words"
                enterKeyHint="next"
                spellCheck={false}
                onChange={(e) => {
                  setWho(e.target.value);
                  setActive(0);
                  setListOpen(true);
                  if (picked && e.target.value !== picked.name) setPicked(null);
                  if (isNew && !e.target.value.trim()) setIsNew(false);
                }}
                // The list opens on a tap, typing or an arrow key, not on the focus the page gives it on load.
                onClick={() => !picked && setListOpen(true)}
                onBlur={() => setListOpen(false)}
                onKeyDown={onWhoKey}
              />
              {listOpen && optionCount > 0 && (
                <ul id={listId} role="listbox" aria-label="Customers" className="pop inv-options">
                  {options.map((o, i) => (
                    <li
                      key={o.key}
                      id={`${listId}-${i}`}
                      role="option"
                      aria-selected={i === active}
                      className="inv-option"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pick(o)}
                      onMouseEnter={() => setActive(i)}
                    >
                      <span className="inv-option-name">{o.name}</span>
                      <span className="meta">{o.kind === "customer" ? (o.hasPastInvoices ? "Customer" : "Customer, no invoices yet") : o.kind === "client" ? "Business" : "Collab deal"}</span>
                    </li>
                  ))}
                  {offerNew && (
                    <li
                      id={`${listId}-${options.length}`}
                      role="option"
                      aria-selected={active === options.length}
                      className="inv-option is-new"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={pickNew}
                      onMouseEnter={() => setActive(options.length)}
                    >
                      <span className="inv-option-name">New customer: {who.trim()}</span>
                    </li>
                  )}
                </ul>
              )}
            </div>
            {errFor("billTo") && <p id={`${uid}-who-err`} role="alert" className="inv-err"><Status tone="danger" small className="is-wrap">{errFor("billTo")}</Status></p>}
            {!errFor("billTo") && nameLeftOut && (
              <p className="inv-err"><Status tone="warn" small className="is-wrap">{nameEmpty ? PDF_LETTERS.name : PDF_LETTERS.leftOut(nameLeftOut)}</Status></p>
            )}

            {(picked || isNew) && (
              <div className="inv-addr">
                {addressOpen || isNew ? (
                  <>
                    <label htmlFor={`${uid}-addr`} className="sr-only">Their address</label>
                    <textarea
                      id={`${uid}-addr`}
                      className="input"
                      rows={2}
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      placeholder={"Their address (optional)\nStreet, city, state ZIP"}
                    />
                    <p className="hint">{picked ? "Saved for next time." : "Printed under their name. Saved for next time."}</p>
                  </>
                ) : (
                  <button type="button" className="inv-quiet" onClick={() => { setAddressOpen(true); requestAnimationFrame(() => document.getElementById(`${uid}-addr`)?.focus()); }}>
                    {oneLineAddress(address) ?? "Add their address"}
                    <span className="sr-only"> (edit the address)</span>
                  </button>
                )}
                {isNew && (
                  <div className="inv-pair">
                    <div>
                      <label htmlFor={`${uid}-contact`} className="label">Contact <span className="font-normal text-muted">(optional)</span></label>
                      <input id={`${uid}-contact`} className="input" value={contactName} onChange={(e) => setContactName(e.target.value)} autoComplete="off" />
                    </div>
                    <div>
                      <label htmlFor={`${uid}-email`} className="label">Email <span className="font-normal text-muted">(optional)</span></label>
                      <input id={`${uid}-email`} className="input" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
                    </div>
                  </div>
                )}
                {last && (
                  <button ref={sameRef} type="button" className="inv-quiet inv-same" aria-busy={last === "loading" || undefined} onClick={() => applyLast()}>
                    {last === "loading" ? "Same as last time…" : "Same as last time"}
                    {last !== "loading" && last.number && <span className="meta"> ({last.number})</span>}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ───────── Lines ───────── */}
      <div className="inv-field">
        <span className="inv-label" id={`${uid}-lines`}>Lines</span>
        <div className="min-w-0">
          {saved.length > 0 && (
            <div className="chips inv-chips" role="group" aria-label="Add a saved line">
              {saved.map((s, i) => (
                <button key={s.id} ref={i === 0 ? firstChipRef : undefined} type="button" className="chip" onClick={() => addSaved(s)}>
                  <span>
                    <b aria-hidden className="inv-plus">+</b>
                    {s.description}
                    {s.unitCents != null && <i>{formatCents(s.unitCents, { decimals: "auto" })}</i>}
                  </span>
                </button>
              ))}
            </div>
          )}

          {lines.length > 0 && (
            <ul className="inv-lines" aria-labelledby={`${uid}-lines`}>
              {lines.map((l, i) => {
                const q = Number(l.quantity);
                let lineTotal: number | null = null;
                try {
                  const c = parseDollars(l.amount);
                  if (c != null && isQuantity(q) && q !== 1) lineTotal = Math.round((Math.round(q * 100) * c) / 100);
                } catch {
                  lineTotal = null;
                }
                const bad = err?.field === "lines" && err.lineKey === l.key;
                return (
                  <li key={l.key} className="inv-line">
                    <input
                      aria-label={`Line ${i + 1} description`}
                      className="input inv-l-desc"
                      value={l.description}
                      onChange={(e) => patchLine(l.key, { description: e.target.value, savedItemId: null })}
                      autoComplete="off"
                    />
                    <input
                      aria-label={`Line ${i + 1} quantity`}
                      className="input inv-l-qty num"
                      inputMode="decimal"
                      value={l.quantity}
                      onChange={(e) => patchLine(l.key, { quantity: e.target.value })}
                      onKeyDown={(e) => onLineEnter(e, l.key)}
                      autoComplete="off"
                    />
                    <span className="inv-l-amt">
                      <span aria-hidden className="inv-dollar">$</span>
                      <input
                        ref={(el) => {
                          if (el) amountRefs.current.set(l.key, el);
                          else amountRefs.current.delete(l.key);
                        }}
                        aria-label={`Line ${i + 1} amount (${l.description || "no description"})`}
                        aria-invalid={bad || undefined}
                        className="input num"
                        inputMode="decimal"
                        enterKeyHint="next"
                        placeholder="0.00"
                        value={l.amount}
                        onChange={(e) => {
                          patchLine(l.key, { amount: e.target.value });
                          if (bad) setErr(null);
                        }}
                        onKeyDown={(e) => onLineEnter(e, l.key)}
                        autoComplete="off"
                      />
                    </span>
                    <button type="button" className={cx(buttonClass("ghost", "sm"), "inv-l-x")} aria-label={`Remove ${l.description || `line ${i + 1}`}`} onClick={() => removeLine(l.key)}>
                      <svg viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg>
                    </button>
                    {lineTotal != null && <span className="inv-l-total meta num">= {formatCents(lineTotal, { decimals: "always" })}</span>}
                  </li>
                );
              })}
            </ul>
          )}

          {/* A custom line: description, amount, Enter adds it. */}
          <div className="inv-line is-new">
            <input
              ref={newDescRef}
              aria-label="New line description"
              className="input inv-l-desc"
              placeholder={lines.length ? "Another line" : "Description"}
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter" || e.metaKey || e.ctrlKey) return;
                e.preventDefault();
                if (newDesc.trim()) newAmountRef.current?.focus();
                else makeRef.current?.focus();
              }}
              enterKeyHint="next"
              autoComplete="off"
            />
            <span className="inv-l-amt">
              <span aria-hidden className="inv-dollar">$</span>
              <input
                ref={newAmountRef}
                aria-label="New line amount"
                className="input num"
                inputMode="decimal"
                placeholder="0.00"
                value={newAmount}
                onChange={(e) => setNewAmount(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || e.metaKey || e.ctrlKey) return;
                  e.preventDefault();
                  if (addCustom()) newDescRef.current?.focus();
                }}
                enterKeyHint="done"
                autoComplete="off"
              />
            </span>
            <button type="button" className={cx(buttonClass("ghost", "sm"), "inv-l-add")} onClick={() => addCustom() && newDescRef.current?.focus()} disabled={!newDesc.trim() && !newAmount.trim()}>
              Add
            </button>
          </div>
          {errFor("lines") && <p role="alert" className="inv-err"><Status tone="danger" small className="is-wrap">{errFor("lines")}</Status></p>}
          {!errFor("lines") && linesLeftOut && <p className="inv-err"><Status tone="warn" small className="is-wrap">{PDF_LETTERS.leftOut(linesLeftOut)}</Status></p>}

          <dl className="inv-sum" aria-live="polite">
            {totals.discountCents > 0 && (
              <>
                <div><dt>Subtotal</dt><dd className="num">{formatCents(totals.subtotalCents, { decimals: "always" })}</dd></div>
                <div><dt>Discount</dt><dd className="num">-{formatCents(totals.discountCents, { decimals: "always" })}</dd></div>
              </>
            )}
            <div className="is-total"><dt>Total</dt><dd className="num">{formatCents(totals.totalCents, { decimals: "always" })}</dd></div>
          </dl>
        </div>
      </div>

      {/* ───────── The defaults, one quiet line ───────── */}
      <div className="inv-defaults" role="group" aria-label="Due date, ways to pay and number">
        <button type="button" className="inv-quiet" aria-expanded={panel === "due"} onClick={() => setPanel(panel === "due" ? null : "due")}>{defaults.due}</button>
        <span aria-hidden>·</span>
        <button type="button" className="inv-quiet" aria-expanded={panel === "pay"} onClick={() => setPanel(panel === "pay" ? null : "pay")}>{defaults.pay}</button>
        {defaults.number && (
          <>
            <span aria-hidden>·</span>
            {edit ? (
              <span className="num">{defaults.number}</span>
            ) : (
              <button type="button" className="inv-quiet num" aria-expanded={panel === "number"} onClick={() => setPanel(panel === "number" ? null : "number")}>
                {defaults.number}
                <span className="sr-only"> (next invoice number)</span>
              </button>
            )}
          </>
        )}
      </div>

      {panel === "due" && (
        <Panel title="Dates" onClose={() => setPanel(null)} error={errFor("due")}>
          <div className="inv-pair">
            <div>
              <label htmlFor={`${uid}-issue`} className="label">Invoice date</label>
              <input id={`${uid}-issue`} type="date" className="input" value={issueDate} onChange={(e) => {
                const v = e.target.value;
                // Due on receipt follows the invoice date.
                setDueDate(dueDate <= issueDate ? v : dueDate);
                setIssueDate(v);
                setDatesTouched(true);
              }} />
            </div>
            <div>
              <label htmlFor={`${uid}-due`} className="label">Due date</label>
              <input id={`${uid}-due`} type="date" className="input" min={issueDate} value={dueDate} onChange={(e) => {
                setIssueDate(issueDate);
                setDueDate(e.target.value);
                setDatesTouched(true);
              }} />
            </div>
          </div>
          <div className="chips mt-3" role="group" aria-label="Due">
            {[0, 7, 15, 30].map((d) => (
              <button key={d} type="button" className="chip" aria-pressed={isYmd(issueDate) && dueDate === addDaysYmd(issueDate, d)} onClick={() => {
                if (!isYmd(issueDate)) return;
                // Days from the invoice date, which still follows today until she picks a date herself.
                if (datesFollowToday) setTerms(d);
                else setDueDate(addDaysYmd(issueDate, d));
              }}>
                <span>{d === 0 ? "Due on receipt" : `${d} days`}</span>
              </button>
            ))}
          </div>
        </Panel>
      )}

      {panel === "pay" && (
        <Panel title="Ways to pay" onClose={() => setPanel(null)} error={errFor("pay")}>
          <ul className="inv-ways">
            {PAY_WAYS.map((w) => {
              const a = availNow[w];
              const on = payWays.includes(w);
              return (
                <li key={w}>
                  <label className={cx("inv-way", !a.ok && !on && "is-off")}>
                    <input type="checkbox" className="check" checked={on} disabled={!a.ok && !on} onChange={(e) => toggleWay(w, e.target.checked)} />
                    <span>
                      {PAY_WAY_LABEL[w]}
                      {!a.ok && a.why && <span className="meta block whitespace-normal">{a.why}</span>}
                    </span>
                  </label>
                  {w === "custom" && on && (
                    <input aria-label="The other way to pay" className="input mt-2" value={payNote} onChange={(e) => setPayNote(e.target.value)} placeholder="Cash at the shoot is fine" maxLength={200} />
                  )}
                </li>
              );
            })}
          </ul>
          <p className="hint">New invoices start with the ways ticked in Settings (Zelle unless you ticked others). No fee is ever added for any way to pay.</p>
        </Panel>
      )}

      {panel === "number" && !edit && (
        <Panel title="Next invoice number" onClose={() => setPanel(null)}>
          <div className="inv-inline">
            <label htmlFor={`${uid}-num`} className="sr-only">Next invoice number</label>
            <input id={`${uid}-num`} className="input num" inputMode="numeric" value={numberText} onChange={(e) => setNumberText(e.target.value)} onKeyDown={(e) => {
              if (e.key === "Enter" && !(e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void saveNumber();
              }
            }} />
            <button type="button" className={buttonClass("secondary")} onClick={saveNumber}>Set</button>
          </div>
          {numberMsg ? (
            <p role="status" className="mt-2"><Status tone={numberMsg.ok ? "ok" : "danger"} small className="is-wrap">{numberMsg.text}</Status></p>
          ) : (
            <p className="hint">Numbers never repeat: it can&apos;t go back onto one already used. Taken when you press Make PDF.</p>
          )}
        </Panel>
      )}

      {/* ───────── More ───────── */}
      <details className="inv-more" open={!!((p.notes && p.source !== "blank") || p.discountCents || p.privateNotes) || undefined}>
        <summary>
          More
          <span className="meta">Discount, notes, language, private note</span>
        </summary>
        <div className="inv-more-body">
          <div>
            <span className="label" id={`${uid}-disc`}>Discount</span>
            <div className="inv-inline">
              <div className="seg" role="group" aria-label="Discount in">
                <button type="button" aria-pressed={discountMode === "$"} onClick={() => setDiscountMode("$")}>$</button>
                <button type="button" aria-pressed={discountMode === "%"} onClick={() => setDiscountMode("%")}>%</button>
              </div>
              <input aria-labelledby={`${uid}-disc`} className="input num inv-disc" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder={discountMode === "$" ? "0.00" : "10"} />
              <input aria-label="Discount label" className="input" value={discountLabel} onChange={(e) => setDiscountLabel(e.target.value)} placeholder="Label (optional)" maxLength={80} />
            </div>
            {(discountError || errFor("discount")) && <p className="inv-err"><Status tone="danger" small>{discountError || errFor("discount")}</Status></p>}
          </div>
          <div>
            <label htmlFor={`${uid}-notes`} className="label">Notes <span className="font-normal text-muted">(printed after NOTES:)</span></label>
            <textarea id={`${uid}-notes`} className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
            {notesLeftOut && <p className="inv-err"><Status tone="warn" small className="is-wrap">{PDF_LETTERS.leftOut(notesLeftOut)}</Status></p>}
          </div>
          <div>
            <label htmlFor={`${uid}-lang`} className="label">Language <span className="font-normal text-muted">(the message and their page; the PDF is English)</span></label>
            <select id={`${uid}-lang`} className="input" value={lang} onChange={(e) => setLang(e.target.value as "" | IntakeLang)}>
              {LANG_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${uid}-private`} className="label">Private note <span className="font-normal text-muted">(only you two see it)</span></label>
            <textarea id={`${uid}-private`} className="input" rows={2} value={privateNotes} onChange={(e) => setPrivateNotes(e.target.value)} maxLength={2000} />
          </div>
        </div>
      </details>

      {/* ───────── The one-time ask ───────── */}
      {setupMissing.length > 0 && (
        <fieldset className="inv-setup">
          <legend className="inv-setup-title">Before your first PDF</legend>
          <p className="meta">Printed at the top and under PAYMENT INFORMATION. Asked once; change it later in Settings.</p>
          {setupMissing.includes("fromName") && (
            <div>
              <label htmlFor={`${uid}-fname`} className="label">Your name</label>
              <input id={`${uid}-fname`} className="input" value={setup.fromName} onChange={(e) => setSetup((s) => ({ ...s, fromName: e.target.value }))} autoComplete="name" />
            </div>
          )}
          {setupMissing.includes("fromAddress") && (
            <div>
              <label htmlFor={`${uid}-faddr`} className="label">Your address</label>
              <textarea id={`${uid}-faddr`} className="input" rows={2} value={setup.fromAddress} onChange={(e) => setSetup((s) => ({ ...s, fromAddress: e.target.value }))} autoComplete="street-address" placeholder={"Street\nCity, state ZIP"} />
            </div>
          )}
          {setupMissing.includes("zelle") && (
            <div>
              <label htmlFor={`${uid}-zelle`} className="label">Zelle number</label>
              <input id={`${uid}-zelle`} className="input" inputMode="tel" value={setup.zelle} aria-invalid={!!errFor("zelle")} onChange={(e) => { setSetup((s) => ({ ...s, zelle: e.target.value })); if (err?.field === "zelle") setErr(null); }} placeholder="Phone or email you use for Zelle" autoComplete="off" />
              {errFor("zelle") && <p role="alert" className="inv-err"><Status tone="danger" small className="is-wrap">{errFor("zelle")}</Status></p>}
            </div>
          )}
        </fieldset>
      )}

      {/* ───────── Make PDF ───────── */}
      <div className="inv-go sticky-actions action-bar">
        {err?.field === "form" && <p role="alert" className="inv-err is-form"><Status tone="danger" small className="is-wrap">{err.message}</Status></p>}
        <div className="inv-go-row">
          <button ref={makeRef} type="button" className={cx(buttonClass("primary"), "inv-make")} onClick={() => void makePdf()} disabled={!!busy} aria-keyshortcuts="Control+Enter Meta+Enter">
            {busy === "pdf" ? (edit ? "Saving…" : "Making PDF…") : edit ? "Save changes" : "Make PDF"}
            <kbd className="inv-kbd" aria-hidden>{mac ? "⌘↵" : "Ctrl ↵"}</kbd>
          </button>
          {!edit && (
            <button type="button" className={buttonClass("ghost")} onClick={() => void saveDraft()} disabled={!!busy}>
              {busy === "draft" ? "Saving…" : p.draftId ? "Save draft" : "Save as draft"}
            </button>
          )}
          <span className="inv-go-total num" aria-hidden>{formatCents(totals.totalCents, { decimals: "always" })}</span>
        </div>
      </div>
    </div>
  );
}

function Panel({ title, onClose, error, children }: { title: string; onClose: () => void; error?: string | null; children: ReactNode }) {
  return (
    <div className="inv-panel" role="group" aria-label={title}>
      <div className="inv-panel-head">
        <p className="eyebrow">{title}</p>
        <button type="button" className={buttonClass("ghost", "sm")} onClick={onClose}>Done</button>
      </div>
      {children}
      {error && <p role="alert" className="inv-err"><Status tone="danger" small className="is-wrap">{error}</Status></p>}
    </div>
  );
}
