/**
 * Checks for src/lib/invoices-types.ts (totals, status, numbers, money, dates, retainers, settings and their defaults,
 * ways to pay, saved lines, the PDF document, the fast creator, contract links, next steps, the card / bank number
 * check, CSV) and the PDF message in lib/invoice-copy. No test framework, just:
 *   npx tsx scripts/test-invoices-types.ts
 * Exits non-zero on the first wrong answer. The core builder extends it. All values are fake.
 */
import assert from "node:assert/strict";
import * as T from "../src/lib/invoices-types";
import { defaultFields, type ContractFields } from "../src/lib/contract";
import { invoiceCopy } from "../src/lib/invoice-copy";

/* totals, status */
assert.equal(T.lineCents({ quantity: 1.15, unitCents: 10000 }), 11500);
assert.equal(T.lineCents({ quantity: 3, unitCents: 3333 }), 9999);
assert.deepEqual(T.invoiceTotals([{ description: "a", quantity: 2, unitCents: 25000 }, { description: "b", quantity: 1, unitCents: 10000 }], 70000), { subtotalCents: 60000, discountCents: 60000, totalCents: 0 });
assert.deepEqual(T.invoiceTotals([{ description: "a", quantity: 1, unitCents: 60000 }], 5000), { subtotalCents: 60000, discountCents: 5000, totalCents: 55000 });
assert.equal(T.mainLineCents([{ description: "Deposit (30%)", quantity: 1, unitCents: 16500 }, { description: "Food Stipend", quantity: 1, unitCents: 7510 }]), 16500);
assert.equal(T.isQuantity(1.5), true); assert.equal(T.isQuantity(1.005), false); assert.equal(T.isQuantity(0), false);
assert.equal(T.settledStatus("sent", 500, 0), "sent"); assert.equal(T.settledStatus("sent", 500, 200), "partially_paid"); assert.equal(T.settledStatus("partially_paid", 500, 500), "paid"); assert.equal(T.settledStatus("paid", 500, 100), "partially_paid"); assert.equal(T.settledStatus("void", 500, 500), "void");
assert.equal(T.invoiceDisplayStatus({ status: "sent", dueDate: "2026-11-19" }, "2026-11-20"), "overdue");
assert.equal(T.invoiceDisplayStatus({ status: "sent", dueDate: "2026-11-20" }, "2026-11-20"), "sent"); // due on receipt: not overdue the same day
assert.equal(T.invoiceDisplayStatus({ status: "paid", dueDate: "2026-01-01" }, "2026-11-20"), "paid");
assert.equal(T.daysOverdue("2026-11-01", "2026-11-20"), 19); assert.equal(T.daysOverdue("2026-03-07", "2026-03-09"), 2);

/* numbers: 7 digits, zero padded, no prefix */
assert.equal(T.formatInvoiceNumber(170), "0000170"); assert.equal(T.formatInvoiceNumber(T.FIRST_INVOICE_NUMBER), "0000170"); assert.equal(T.formatInvoiceNumber(12345678), "12345678");
assert.equal(T.parseInvoiceNumber("0000170"), 170); assert.equal(T.parseInvoiceNumber("169"), 169); assert.equal(T.parseInvoiceNumber("INV-2026-0007"), null); assert.equal(T.parseInvoiceNumber(""), null);
assert.equal(T.normalizeImportedNumber("169"), "0000169"); assert.equal(T.normalizeImportedNumber("# 0000169"), "0000169"); assert.equal(T.normalizeImportedNumber(" SKY-12 "), "SKY-12"); assert.equal(T.normalizeImportedNumber("  "), null);
assert.equal(T.invoiceLabel({ number: null }), "Draft"); assert.equal(T.invoiceLabel({ number: "0000170" }), "0000170");

/* money */
assert.equal(T.formatCents(60000), "$600.00"); assert.equal(T.formatCents(60000, { decimals: "auto" }), "$600"); assert.equal(T.formatCents(125050, { decimals: "auto" }), "$1,250.50");
assert.equal(T.pdfAmount(55000), "550.00"); assert.equal(T.pdfAmount(7510), "75.10"); assert.equal(T.pdfAmount(125050), "1,250.50"); assert.equal(T.pdfAmount(0), "0.00");
assert.equal(T.pdfQuantity(1), "1.00"); assert.equal(T.pdfQuantity(1.5), "1.50");
assert.equal(T.parseDollars("$1,250.50"), 125050); assert.equal(T.parseDollars("600.5"), 60050); assert.equal(T.parseDollars(" "), null);
assert.throws(() => T.parseDollars("1.234"), T.MoneyInputError); assert.throws(() => T.parseDollars("-5"), T.MoneyInputError);
assert.equal(T.centsToDollarsInput(125050), "1250.50"); assert.equal(T.centsToDollarsInput(60000), "600");
assert.equal(T.stripeFeeEstimateCents(60000, "stripe_ach"), 480); assert.equal(T.stripeFeeEstimateCents(100000, "stripe_ach"), 500); assert.equal(T.stripeFeeEstimateCents(60000, "stripe_card"), 1770);

/* dates: due on receipt by default */
assert.equal(T.DEFAULT_TERMS_DAYS, 0);
assert.deepEqual(T.resolveInvoiceDates({ issueDate: null, dueDate: null, termsDays: T.DEFAULT_TERMS_DAYS }, "2026-11-20"), { issueDate: "2026-11-20", dueDate: "2026-11-20" });
assert.deepEqual(T.resolveInvoiceDates({ issueDate: "2026-11-01", dueDate: null, termsDays: 30 }, "2026-11-20"), { issueDate: "2026-11-01", dueDate: "2026-12-01" });
assert.equal(T.usDate("2026-11-20"), "11/20/2026"); assert.equal(T.usDate(null), "");
assert.equal(T.dueLabel("2026-11-20", "2026-11-20"), "Due on receipt"); assert.equal(T.dueLabel("2026-11-20", "2026-12-05"), "Due Dec 5");
assert.equal(T.daysBetween("2026-11-20", "2026-12-05"), 15);
assert.equal(T.isYmd("2026-02-30"), false); assert.equal(T.isYmd("2026-02-28"), true);

/* customers, addresses */
assert.equal(T.customerNameKey("Crab O' Clock, LLC"), "crab o clock llc"); assert.equal(T.customerNameKey("S&F Kingdom"), "s and f kingdom"); assert.equal(T.customerNameKey("红碗 Yummy"), "红碗 yummy");
assert.equal(T.oneLineAddress("1 Example Ave,\nSampleton, VA 23000\n"), "1 Example Ave, Sampleton, VA 23000"); assert.equal(T.oneLineAddress(" "), null);
assert.deepEqual(T.addressLines("100 Sample St\n\nSampleton, VA 23000"), ["100 Sample St", "Sampleton, VA 23000"]);

/* retainers */
const r = { active: true, dayOfMonth: 5, startMonth: null, lastRunMonth: null };
assert.equal(T.retainerDue(r, "2026-11-04"), false); assert.equal(T.retainerDue(r, "2026-11-05"), true); assert.equal(T.retainerDue({ ...r, lastRunMonth: "2026-11" }, "2026-11-20"), false); assert.equal(T.retainerDue({ ...r, startMonth: "2026-12" }, "2026-11-20"), false); assert.equal(T.retainerDue({ ...r, active: false }, "2026-11-20"), false);
assert.equal(T.retainerItemDescription("Social media services", "2026-11"), "Social media services (November 2026)");

/* card / bank guard, CSV */
assert.equal(T.looksLikeCardOrBankNumber("4242 4242 4242 4242"), true); assert.equal(T.looksLikeCardOrBankNumber("Zelle: (555) 010-0100"), false);
assert.equal(T.looksLikeCardOrBankNumber("routing 021000021 account 12345678"), true); assert.equal(T.looksLikeCardOrBankNumber("Check #1043 for $600"), false);
assert.equal(T.looksLikeCardOrBankNumber("Order 1234567890123"), false); // 13 digits failing Luhn
assert.equal(T.toCsv([["Date", "Customer", "Amount"], ["2026-11-20", "=HYPERLINK(1)", -5], ["2026-11-21", 'Say "hi", ok', T.csvAmount(125050)]]), 'Date,Customer,Amount\r\n2026-11-20,\'=HYPERLINK(1),-5\r\n2026-11-21,"Say ""hi"", ok",1250.50\r\n');

/* settings: defaults (card OFF, bank transfer on, due on receipt, the two saved lines) */
const d = T.readInvoiceSettings({});
assert.equal(d.cardEnabled, false); assert.equal(d.achEnabled, true); assert.equal(d.termsDays, 0);
assert.deepEqual(d.savedItems, [{ id: "package", description: "Standard Content Creation Package", unitCents: 55000 }, { id: "food-stipend", description: "Food Stipend", unitCents: null }]);
assert.deepEqual(T.readInvoiceSettings({ savedItems: [] }).savedItems, []); // edited to none stays none
assert.deepEqual(T.readInvoiceSettings({ savedItems: [{ id: "a", description: " Reel ", unitCents: 30000 }, { id: "b" }, "x", { id: "c", description: "Bad", unitCents: -1 }] }).savedItems, [{ id: "a", description: "Reel", unitCents: 30000 }, { id: "c", description: "Bad", unitCents: null }]);
const s = T.readInvoiceSettings({ line: "Zelle: x", zelle: " (555) 010-0100 ", fromName: "Nora Chen", fromAddress: "100 Sample St\nSampleton, VA 23000", cardEnabled: true, termsDays: 999 });
assert.equal(s.zelle, "(555) 010-0100"); assert.equal(s.cardEnabled, true); assert.equal(s.termsDays, 0);
assert.deepEqual(T.invoiceSetupMissing(d), ["fromName", "fromAddress", "zelle"]); assert.deepEqual(T.invoiceSetupMissing(s), []);
assert.equal(T.SETUP_PREFILL.fromName, "Nora Chen");

/* ways to pay: Zelle by default, Zelle first, card only when turned on, online only with Stripe */
assert.deepEqual(T.sortPayWays(["card", "zelle", "zelle", "nope"]), ["zelle", "card"]); assert.deepEqual(T.sortPayWays([]), ["zelle"]); assert.deepEqual(T.sortPayWays(null), ["zelle"]);
assert.equal(T.payWaysLabel(["zelle"]), "Zelle"); assert.equal(T.payWaysLabel(["bank", "check", "zelle"]), "Zelle, check, bank transfer online"); assert.equal(T.payWaysLabel(["paypal"]), "PayPal");
assert.equal(T.hasOnlineWay(["zelle"]), false); assert.equal(T.hasOnlineWay(["zelle", "bank"]), true);
const off = T.availablePayWays(d, true);
assert.equal(off.zelle.ok, false); assert.equal(off.bank.ok, true); assert.equal(off.card.ok, false); assert.match(off.card.why ?? "", /Card is off/); assert.equal(off.custom.ok, true);
const noStripe = T.availablePayWays(s, false);
assert.equal(noStripe.zelle.ok, true); assert.equal(noStripe.bank.ok, false); assert.equal(noStripe.card.ok, false);
assert.equal(T.checkPayWays(["zelle"], null, noStripe), null); assert.match(T.checkPayWays(["zelle", "bank"], null, noStripe) ?? "", /Stripe/);
assert.equal(T.checkPayWays(["custom"], " ", noStripe), "Type the other way to pay."); assert.equal(T.checkPayWays([], null, noStripe), "Pick at least one way to pay.");
assert.equal(T.zelleMemo("0000170"), "Put invoice 0000170 in the Zelle memo");
const opts = T.payOptions(s, { number: "0000170", payWays: ["bank", "zelle", "custom"], payNote: "Cash at the shoot is fine" }, false);
assert.deepEqual(opts, [{ way: "zelle", to: "(555) 010-0100", name: null, memo: "Put invoice 0000170 in the Zelle memo" }, { way: "custom", text: "Cash at the shoot is fine" }]); // bank left out without Stripe
assert.deepEqual(T.payOptions(s, { number: "0000170", payWays: ["zelle", "bank", "card"], payNote: null }, true).map((o) => o.way), ["zelle", "bank", "card"]);
assert.deepEqual(T.payOptions(d, { number: "0000170", payWays: ["zelle", "card"], payNote: null }, true).map((o) => o.way), []); // no Zelle number, card off
assert.equal(T.noPayOptions([]), true);
assert.deepEqual(T.paymentInfoLines(opts, null), ["(555) 010-0100 [Zelle]", "Put invoice 0000170 in the Zelle memo", "Cash at the shoot is fine"]);
assert.deepEqual(T.paymentInfoLines([{ way: "bank" }], "https://hq.example.com/i/abc"), ["Pay online by bank transfer: https://hq.example.com/i/abc"]);
assert.deepEqual(T.paymentInfoLines([{ way: "bank" }, { way: "card" }], null), []); // no link: no online line
assert.deepEqual(T.paymentInfoLines([{ way: "check", payee: "Nora Chen", address: "100 Sample St\nSampleton, VA 23000" }], null), ["Check payable to Nora Chen, mail to 100 Sample St, Sampleton, VA 23000"]);
assert.equal(T.PAY_WAY_METHOD.zelle, "zelle"); assert.equal(T.PAY_WAY_METHOD.custom, "other");

/* saved lines, "Same as last time", ready items */
const saved = d.savedItems;
assert.deepEqual(T.lineFromSavedItem(saved[0]), { description: "Standard Content Creation Package", quantity: 1, unitCents: 55000, savedItemId: "package" });
assert.deepEqual(T.lineFromSavedItem(saved[1]), { description: "Food Stipend", quantity: 1, unitCents: null, savedItemId: "food-stipend" });
assert.equal(T.packageItem(saved).id, "package"); assert.equal(T.packageItem([]).description, "Standard Content Creation Package");
const last = T.sameAsLastTime([{ description: "Standard Content Creation Package", quantity: 1, unitCents: 55000 }, { description: "food stipend", quantity: 1, unitCents: 7510 }, { description: "Extra reel", quantity: 2, unitCents: 10000 }], saved);
assert.deepEqual(last, [
  { description: "Standard Content Creation Package", quantity: 1, unitCents: 55000, savedItemId: "package" },
  { description: "food stipend", quantity: 1, unitCents: null, savedItemId: "food-stipend" }, // typed each time
  { description: "Extra reel", quantity: 2, unitCents: 10000, savedItemId: null },
]);
assert.deepEqual(T.readyItems(last), { items: null, error: "Type the amount for food stipend." });
assert.deepEqual(T.readyItems([{ ...last[0] }, { description: " ", quantity: 1, unitCents: null, savedItemId: null }]), { items: [{ description: "Standard Content Creation Package", quantity: 1, unitCents: 55000 }], error: null });
assert.equal(T.readyItems([]).error, "Add at least one line."); assert.equal(T.readyItems([{ description: "Free", quantity: 1, unitCents: 0, savedItemId: null }]).error, "The total is $0.");

/* the PDF document: her Skynova layout and wording (fake values) */
const inv = {
  number: "0000170", status: "sent" as const, issueDate: "2026-11-20", dueDate: "2026-11-20", termsDays: 0,
  items: [{ description: "Standard Content Creation Package", quantity: 1, unitCents: 55000 }, { description: "Food Stipend", quantity: 1, unitCents: 7510 }],
  subtotalCents: 62510, discountCents: 0, discountLabel: null, totalCents: 62510, paidCents: 0, notes: null, payWays: ["zelle" as const], payNote: null,
};
const doc = T.invoiceDocument(inv, { name: "Sample Bistro", billingAddress: "1 Example Ave\nSampleton, VA 23000" }, s, { stripeReady: false, payUrl: null, today: "2026-11-20" });
assert.equal(doc.stamp, null); assert.equal(doc.title, "INVOICE");
assert.deepEqual(doc.from, { name: "Nora Chen", addressLines: ["100 Sample St", "Sampleton, VA 23000"], email: null, phone: null });
assert.deepEqual(doc.billTo, { name: "Sample Bistro", address: "1 Example Ave, Sampleton, VA 23000" });
assert.deepEqual(doc.facts, [{ label: "Invoice #", value: "0000170" }, { label: "Invoice Date", value: "11/20/2026" }, { label: "Due Date", value: "11/20/2026" }]);
assert.deepEqual(doc.columns, ["Description", "Unit Price", "Quantity", "Amount"]); // no "Item: Service" column
assert.deepEqual(doc.rows, [
  { description: "Standard Content Creation Package", unitPrice: "550.00", quantity: "1.00", amount: "550.00" },
  { description: "Food Stipend", unitPrice: "75.10", quantity: "1.00", amount: "75.10" },
]);
assert.equal(doc.notes, null); assert.equal(doc.paymentHeading, "PAYMENT INFORMATION:");
assert.deepEqual(doc.paymentLines, ["(555) 010-0100 [Zelle]", "Put invoice 0000170 in the Zelle memo"]);
assert.deepEqual(doc.totals, [
  { label: "Subtotal", value: "625.10" }, { label: "Total", value: "625.10" }, { label: "Amount Paid", value: "0.00" },
  { label: "Balance Due", value: "$625.10", strong: true },
]);
assert.equal(doc.fileName, "Invoice 0000170 - Sample Bistro.pdf");
const draftDoc = T.invoiceDocument({ ...inv, number: null, status: "draft", issueDate: null, dueDate: null, discountCents: 2510, discountLabel: "Repeat", totalCents: 60000 }, { name: "Sample Bistro", billingAddress: null }, s, { stripeReady: false, payUrl: null, today: "2026-11-21" });
assert.equal(draftDoc.stamp, "DRAFT"); assert.equal(draftDoc.facts[0].value, "DRAFT"); assert.equal(draftDoc.facts[2].value, "11/21/2026");
assert.deepEqual(draftDoc.totals[1], { label: "Discount (Repeat)", value: "-25.10" }); assert.equal(draftDoc.billTo.address, null);
assert.equal(T.invoiceFileName("0000170", "SAMPLE Bakery 小点心 / Café?"), "Invoice 0000170 - SAMPLE Bakery 小点心 Café.pdf");
assert.equal(T.invoicePdfPath("inv_1"), "/invoices/inv_1/pdf"); assert.equal(T.invoicePdfPath("inv_1", { download: true }), "/invoices/inv_1/pdf?download=1");

/* the fast creator */
assert.deepEqual(T.creatorDefaultsLine({ issueDate: "2026-11-20", dueDate: "2026-11-20", payWays: ["zelle"], nextNumber: "0000170" }), { due: "Due on receipt", pay: "Zelle", number: "#0000170", text: "Due on receipt · Zelle · #0000170" });
const opt = (kind: T.BillToKind, id: string, name: string): T.BillToOption => ({ key: `${kind}:${id}`, kind, id, name, nameKey: T.customerNameKey(name), address: null, contactName: null, email: null, lang: null, customerId: kind === "customer" ? id : null, hasPastInvoices: false });
const list = [opt("client", "snf", "SNF Kingdom"), opt("customer", "c1", "Sample Bistro"), opt("deal", "d1", "Sample Bakery 小点心"), opt("customer", "c2", "Crab O Clock")];
assert.deepEqual(T.filterBillTo(list, "sam").map((o) => o.key), ["customer:c1", "deal:d1"]);
assert.deepEqual(T.filterBillTo(list, "clock").map((o) => o.key), ["customer:c2"]);
assert.deepEqual(T.filterBillTo(list, "小点").map((o) => o.key), ["deal:d1"]);
assert.equal(T.filterBillTo(list, "").length, 4);

/* done state and next steps */
assert.deepEqual(T.doneActions({ payUrl: null }, { canShareFiles: true }), ["share_pdf", "download_pdf", "copy_message"]);
assert.deepEqual(T.doneActions({ payUrl: "https://x/i/t" }, { canShareFiles: false }), ["download_pdf", "copy_message", "copy_pay_link"]);
assert.deepEqual(T.invoiceNextSteps({ id: "inv_1", status: "sent", contractId: null }).map((n) => n.kind), ["record_payment", "remind", "make_contract"]);
assert.deepEqual(T.invoiceNextSteps({ id: "inv_1", status: "paid", contractId: "ctr_1" }), []);
assert.deepEqual(T.invoiceNextSteps({ id: "inv_1", status: "draft", contractId: null }), [{ kind: "make_contract", label: "Make contract", href: "/contracts?invoice=inv_1" }]);

/* contracts ⇄ invoices */
const today = "2026-11-20";
const collab = (over: Partial<ContractFields>): ContractFields => ({ ...defaultFields(today), clientBusiness: "Sample Bistro", clientContact: "Sam Sample", fee: "550", paymentDays: "15", ...over });
const full = T.invoiceFromContractFields(collab({}), { savedItems: saved, today });
assert.deepEqual(full, { part: "full", lines: [{ description: "Standard Content Creation Package", quantity: 1, unitCents: 55000, savedItemId: "package" }], issueDate: today, dueDate: "2026-12-05" });
const dep = T.invoiceFromContractFields(collab({ depositPercent: "30" }), { savedItems: saved, today });
assert.deepEqual(dep, { part: "deposit", lines: [{ description: "Deposit (30%)", quantity: 1, unitCents: 16500, savedItemId: null }], issueDate: today, dueDate: today });
const rest = T.invoiceFromContractFields(collab({ depositPercent: "30" }), { savedItems: saved, today, invoicedCents: 16500 });
assert.deepEqual(rest, { part: "rest", lines: [{ description: "Standard Content Creation Package, remaining 70%", quantity: 1, unitCents: 38500, savedItemId: null }], issueDate: today, dueDate: "2026-12-05" });
assert.equal(T.invoiceFromContractFields(collab({ depositPercent: "30" }), { savedItems: saved, today, invoicedCents: 55000 }), null);
assert.equal(T.invoiceFromContractFields(collab({ depositPercent: "100" }), { savedItems: saved, today })?.dueDate, today);
assert.equal(T.invoiceFromContractFields(collab({ fee: "" }), { savedItems: saved, today }), null); // gifted
const monthly = collab({ kind: "monthly", fee: "800", startDate: "2026-12-03", termMonths: "3", paymentDays: "10" });
assert.deepEqual(T.invoiceFromContractFields(monthly, { savedItems: saved, today })?.lines[0], { description: "Social media services (December 2026)", quantity: 1, unitCents: 80000, savedItemId: null });
assert.deepEqual(T.retainerFromContractFields(monthly, today), { description: "Social media services", amountCents: 80000, dayOfMonth: 3, startMonth: "2026-12", termMonths: 3 });
assert.equal(T.retainerFromContractFields(collab({}), today), null);
assert.equal(T.retainerFromContractFields({ ...monthly, startDate: "2026-12-31" }, today)?.dayOfMonth, 28);
assert.equal(T.contractFeeCents("$1,250.50"), 125050); assert.equal(T.contractFeeCents(""), 0);
assert.deepEqual(T.contractFieldsFromInvoice({ items: inv.items, retainerId: null }, { name: "Sample Bistro", contactName: "Sam Sample", email: "sam@sample.test" }, today), { kind: "collab", clientBusiness: "Sample Bistro", clientContact: "Sam Sample", clientEmail: "sam@sample.test", agreementDate: today, fee: "550" });
assert.equal(T.contractFieldsFromInvoice({ items: [{ description: "Social media services (November 2026)", quantity: 1, unitCents: 80000 }], retainerId: "ret_1" }, { name: "X", contactName: null, email: null }, today).kind, "monthly");
const ref = (over: Partial<T.ContractInvoiceRef>): T.ContractInvoiceRef => ({ id: "inv_1", number: "0000170", status: "paid", display: "paid", issueDate: today, totalCents: 16500, balanceCents: 0, mainLineCents: 16500, ...over });
assert.equal(T.invoiceRefLabel(ref({})), "0000170 · Paid"); assert.equal(T.invoiceRefLabel(ref({ number: null, display: "draft" })), "Draft · Draft");
const c = (fields: ContractFields) => ({ id: "ctr_1", kind: fields.kind, fields });
assert.deepEqual(T.contractNextSteps(c(collab({})), [], { hasRetainer: false, today }), [{ kind: "make_invoice", label: "Make invoice", href: "/invoices/new?contract=ctr_1" }]);
assert.equal(T.contractNextSteps(c(collab({ depositPercent: "30" })), [], { hasRetainer: false, today })[0].label, "Make deposit invoice");
assert.deepEqual(T.contractNextSteps(c(collab({ depositPercent: "30" })), [ref({})], { hasRetainer: false, today }), [{ kind: "make_invoice", label: "Invoice the rest", href: "/invoices/new?contract=ctr_1&part=rest" }]);
assert.deepEqual(T.contractNextSteps(c(collab({ depositPercent: "30" })), [ref({ status: "void", display: "void" })], { hasRetainer: false, today })[0].label, "Make deposit invoice"); // a void invoice doesn't count
assert.deepEqual(T.contractNextSteps(c(collab({})), [ref({ mainLineCents: 55000 })], { hasRetainer: false, today }), []);
assert.deepEqual(T.contractNextSteps(c(monthly), [], { hasRetainer: false, today }).map((n) => n.label), ["Set up monthly invoices", "Invoice this month"]);
assert.deepEqual(T.contractNextSteps(c(monthly), [ref({})], { hasRetainer: true, today }), []);
assert.deepEqual(T.contractNextSteps(c(collab({ fee: "0" })), [], { hasRetainer: false, today }), []);
assert.equal(T.contractRefLabel({ agreementDate: "2026-11-20", createdAt: "2026-11-21T10:00:00.000Z" }), "Contract Nov 20");
assert.equal(T.contractRefLabel({ agreementDate: null, createdAt: "2026-11-21T10:00:00.000Z" }), "Contract Nov 21");

/* the text sent with the PDF (lib/invoice-copy share.pdfMessage) */
const msg = { business: "Sample Bistro", contactName: "Sam Sample", number: "0000170", amount: "$625.10", dueDate: today, dueOnReceipt: true, zelle: "(555) 010-0100", url: null };
assert.equal(invoiceCopy("en").share.pdfMessage(msg), "Hi Sam! Here is invoice 0000170 for $625.10, due on receipt. The PDF is attached.\n\nZelle: (555) 010-0100, with 0000170 in the memo.\n\nThank you!");
assert.equal(invoiceCopy("en").share.pdfMessage({ ...msg, zelle: null, dueOnReceipt: false, dueDate: "2026-12-05", url: "https://hq.example.com/i/t" }), "Hi Sam! Here is invoice 0000170 for $625.10, due Dec 5. The PDF is attached.\n\nPay online: https://hq.example.com/i/t\n\nThank you!");
assert.match(invoiceCopy("zh-Hans").share.pdfMessage(msg), /^Sample Bistro，您好！附上账单 0000170（PDF），金额 \$625\.10，收到即付。\n\nZelle：\(555\) 010-0100，备注请写 0000170。\n\n谢谢！$/);
assert.match(invoiceCopy("zh-Hant").share.pdfMessage(msg), /帳單 0000170.*備註請寫 0000170/s);
for (const lang of ["en", "zh-Hans", "zh-Hant"] as const) assert.doesNotMatch(invoiceCopy(lang).share.pdfMessage({ ...msg, url: "https://x" }), /\u2014|fee|surcharge|手续费|手續費/i);

console.log("invoices-types helpers: ok");
