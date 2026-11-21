/**
 * Checks for src/lib/invoices-types.ts (totals, status, numbers, money, dates, retainers, settings and their defaults,
 * ways to pay, saved lines, the PDF document, the fast creator, contract links, next steps, the card / bank number
 * check, CSV) and the PDF message in lib/invoice-copy. No test framework, just:
 *   npx tsx scripts/test-invoices-types.ts
 * Exits non-zero on the first wrong answer. The core builder extends it. All values are fake.
 */
import assert from "node:assert/strict";
import * as T from "../src/lib/invoices-types";
import { defaultFields, readContractFields, type ContractFields } from "../src/lib/contract";
import { invoiceCopy } from "../src/lib/invoice-copy";
import { buildInvoiceMessages, formatInvoiceAmount, mailtoHref } from "../src/lib/payment-request";

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

/* settings: defaults (card OFF, bank transfer on, due on receipt, the two saved lines, no bank account, Zelle for new invoices) */
const d = T.readInvoiceSettings({});
assert.equal(d.cardEnabled, false); assert.equal(d.achEnabled, true); assert.equal(d.termsDays, 0);
assert.equal(d.ownBankLabel, null); assert.equal(d.ownBankLast4, null); assert.equal(d.ownBankRouting, null); assert.equal(d.ownBankUnreadable, false); assert.deepEqual(d.payDefaults, []);
assert.deepEqual(d.savedItems, [{ id: "package", description: "Standard Content Creation Package", unitCents: 55000 }, { id: "food-stipend", description: "Food Stipend", unitCents: null }]);
assert.deepEqual(T.readInvoiceSettings({ savedItems: [] }).savedItems, []); // edited to none stays none
assert.deepEqual(T.readInvoiceSettings({ savedItems: [{ id: "a", description: " Reel ", unitCents: 30000 }, { id: "b" }, "x", { id: "c", description: "Bad", unitCents: -1 }] }).savedItems, [{ id: "a", description: "Reel", unitCents: 30000 }, { id: "c", description: "Bad", unitCents: null }]);
const s = T.readInvoiceSettings({ line: "Zelle: x", zelle: " (555) 010-0100 ", fromName: "Nora Chen", fromAddress: "100 Sample St\nSampleton, VA 23000", cardEnabled: true, termsDays: 999 });
assert.equal(s.zelle, "(555) 010-0100"); assert.equal(s.cardEnabled, true); assert.equal(s.termsDays, 0);
assert.deepEqual(T.invoiceSetupMissing(d), ["fromName", "fromAddress", "zelle"]); assert.deepEqual(T.invoiceSetupMissing(s), []);
assert.equal(T.SETUP_PREFILL.fromName, "Nora Chen");

/* ways to pay: Zelle by default, Zelle first in the pickers, card only when turned on, online only with Stripe */
assert.deepEqual(T.sortPayWays(["card", "zelle", "zelle", "nope"]), ["zelle", "card"]); assert.deepEqual(T.sortPayWays([]), ["zelle"]); assert.deepEqual(T.sortPayWays(null), ["zelle"]);
assert.deepEqual(T.sortPayWays(["check", "ach", "zelle"]), ["zelle", "ach", "check"], "the pickers list Zelle, bank transfer (ACH), check");
assert.deepEqual(T.printPayWays(["check", "zelle", "ach", "bank"]), ["ach", "zelle", "check", "bank"], "printed as she writes them: bank account, Zelle, checks");
assert.deepEqual(T.printPayWays([]), ["zelle"]);
assert.equal(T.payWaysLabel(["zelle"]), "Zelle"); assert.equal(T.payWaysLabel(["bank", "check", "zelle"]), "Zelle, check, bank transfer online"); assert.equal(T.payWaysLabel(["paypal"]), "PayPal");
assert.equal(T.payWaysLabel(["check", "ach", "zelle"]), "Zelle, bank transfer (ACH), check"); assert.equal(T.payWaysLabel(["ach"]), "Bank transfer (ACH)");
assert.equal(T.PAY_WAY_LABEL.ach, "Bank transfer (ACH)"); assert.equal(T.PAY_WAY_LABEL.bank, "Bank transfer online", "the Stripe way keeps its own name");
assert.equal(T.DEFAULT_PAY_WAYS.join(), "zelle", "the built-in default stays Zelle only");
assert.equal(T.hasOnlineWay(["zelle"]), false); assert.equal(T.hasOnlineWay(["zelle", "bank"]), true);
const off = T.availablePayWays(d, true);
assert.equal(off.zelle.ok, false); assert.equal(off.bank.ok, true); assert.equal(off.card.ok, false); assert.match(off.card.why ?? "", /Card is off/); assert.equal(off.custom.ok, true);
const noStripe = T.availablePayWays(s, false);
assert.equal(noStripe.zelle.ok, true); assert.equal(noStripe.bank.ok, false); assert.equal(noStripe.card.ok, false);
assert.equal(T.checkPayWays(["zelle"], null, noStripe), null); assert.match(T.checkPayWays(["zelle", "bank"], null, noStripe) ?? "", /Stripe/);
assert.equal(T.checkPayWays(["custom"], " ", noStripe), "Type the other way to pay."); assert.equal(T.checkPayWays([], null, noStripe), "Pick at least one way to pay.");
assert.equal(T.zelleMemo("0000170"), "Put invoice 0000170 in the Zelle memo");
const opts = T.payOptions(s, { number: "0000170", payWays: ["bank", "zelle", "custom"], payNote: "Cash at the shoot is fine" }, false, null);
assert.deepEqual(opts, [{ way: "zelle", to: "(555) 010-0100", name: null, memo: "Put invoice 0000170 in the Zelle memo" }, { way: "custom", text: "Cash at the shoot is fine" }]); // bank left out without Stripe
assert.deepEqual(T.payOptions(s, { number: "0000170", payWays: ["zelle", "bank", "card"], payNote: null }, true, null).map((o) => o.way), ["zelle", "bank", "card"]);
assert.deepEqual(T.payOptions(d, { number: "0000170", payWays: ["zelle", "card"], payNote: null }, true, null).map((o) => o.way), []); // no Zelle number, card off
assert.equal(T.noPayOptions([]), true);
assert.deepEqual(T.paymentInfoLines(opts, null), ["Please send payment via Zelle to (555) 010-0100.", "Put invoice 0000170 in the Zelle memo", "", "Cash at the shoot is fine"]);
assert.deepEqual(T.paymentInfoLines([{ way: "bank" }], "https://hq.example.com/i/abc"), ["Pay online by bank transfer: https://hq.example.com/i/abc"]);
assert.deepEqual(T.paymentInfoLines([{ way: "bank" }, { way: "card" }], null), []); // no link: no online line
assert.deepEqual(T.paymentInfoLines([{ way: "check", payee: "Nora Chen", address: "100 Sample St\nSampleton, VA 23000" }], null), ["Checks Payable to Nora Chen", "Mail to 100 Sample St, Sampleton, VA 23000"]);
assert.deepEqual(T.paymentInfoLines([{ way: "check", payee: "Nora Chen", address: null }], null), ["Checks Payable to Nora Chen"], "no mailing address saved: no Mail to line");
assert.equal(T.PAY_WAY_METHOD.zelle, "zelle"); assert.equal(T.PAY_WAY_METHOD.custom, "other"); assert.equal(T.PAY_WAY_METHOD.ach, "ach");
assert.equal(T.PAYMENT_METHOD_LABEL.ach, "Bank transfer (ACH)"); assert.ok((T.MANUAL_PAYMENT_METHODS as readonly string[]).includes("ach"), "a person can record a bank transfer");

/* her own bank account (the "ach" way): the PAYMENT INFORMATION block, exactly as she writes it. Fake values only. */
const BANK: T.BankDetails = { account: "000123456789", routing: "000000000" };
const three = T.readInvoiceSettings({ zelle: "5550100100", checkPayee: "Nora Chen", checkAddress: "100 Sample St\nSampleton, VA 23000", ownBankLabel: "Sample Bank Checking", ownBankEnc: "v1.x.y.z" }, BANK);
assert.equal(three.ownBankLast4, "6789"); assert.equal(three.ownBankRouting, "000000000"); assert.equal(three.ownBankUnreadable, false);
assert.doesNotMatch(JSON.stringify(three), /000123456789|v1\.x\.y\.z/, "the settings object never holds the account number or the ciphertext");
const all3 = T.payOptions(three, { number: "0000170", payWays: ["check", "zelle", "ach"], payNote: null }, false, BANK);
assert.deepEqual(all3.map((o) => o.way), ["ach", "zelle", "check"], "her order: bank account, Zelle, checks");
assert.deepEqual(T.paymentInfoLines(all3, null), [
  "Sample Bank Checking",
  "ACH to ACCT#:000123456789",
  "ROUTING:000000000",
  "",
  "Please send payment via Zelle to 5550100100.",
  "Put invoice 0000170 in the Zelle memo",
  "",
  "Checks Payable to Nora Chen",
  "Mail to 100 Sample St, Sampleton, VA 23000",
]);
assert.equal(T.paymentInfoLines(all3, null).join("\n"), "Sample Bank Checking\nACH to ACCT#:000123456789\nROUTING:000000000\n\nPlease send payment via Zelle to 5550100100.\nPut invoice 0000170 in the Zelle memo\n\nChecks Payable to Nora Chen\nMail to 100 Sample St, Sampleton, VA 23000");
// only the ways chosen: no bank block on a Zelle and check invoice, no blank line at either end
assert.deepEqual(T.paymentInfoLines(T.payOptions(three, { number: "0000171", payWays: ["zelle", "check"], payNote: null }, false, BANK), null), ["Please send payment via Zelle to 5550100100.", "Put invoice 0000171 in the Zelle memo", "", "Checks Payable to Nora Chen", "Mail to 100 Sample St, Sampleton, VA 23000"]);
assert.deepEqual(T.paymentInfoLines(T.payOptions({ ...three, ownBankLabel: null }, { number: "0000171", payWays: ["ach"], payNote: null }, false, BANK), null), ["ACH to ACCT#:000123456789", "ROUTING:000000000"], "no label saved: the two numbers only");
assert.deepEqual(T.paymentInfoLines([{ way: "zelle", to: "5550100100", name: "Nora C", memo: T.zelleMemo("0000170") }], null), ["Please send payment via Zelle to 5550100100.", "Put invoice 0000170 in the Zelle memo", "Zelle shows Nora C"]);
assert.deepEqual(T.payOptions(three, { number: "0000170", payWays: ["ach", "zelle"], payNote: null }, false, null).map((o) => o.way), ["zelle"], "no bank details given: the way is left out, never printed empty");
for (const l of T.paymentInfoLines(all3, null)) assert.doesNotMatch(l, /\[Zelle|Check payable to|, mail to/, "the old wording is gone");
// a team page and a message: the account masked, or not there at all
const masked = T.maskedBankDetails(three);
assert.deepEqual(masked, { account: "••••6789", routing: "000000000" }); assert.equal(T.maskedBankDetails(d), null);
const teamLines = T.paymentInfoLines(T.payOptions(three, { number: "0000170", payWays: ["ach", "zelle", "check"], payNote: null }, false, masked), null);
assert.deepEqual(teamLines.slice(0, 3), ["Sample Bank Checking", "ACH to ACCT#:••••6789", "ROUTING:000000000"]); assert.doesNotMatch(teamLines.join("\n"), /000123456789/);
const msgLines = T.paymentMessageLines(all3, null);
assert.deepEqual(msgLines, ["Bank transfer (ACH): the account details are on the PDF.", "Please send payment via Zelle to 5550100100.", "Put invoice 0000170 in the Zelle memo", "Checks Payable to Nora Chen", "Mail to 100 Sample St, Sampleton, VA 23000"]);
assert.doesNotMatch(msgLines.join("\n"), /000123456789|000000000|ACCT#|ROUTING/, "a message never repeats the account or routing number, even built from the real ones");
// availability and the ways ticked for new invoices
const av3 = T.availablePayWays(three, false);
assert.equal(av3.ach.ok, true); assert.equal(T.availablePayWays(d, true).ach.ok, false); assert.match(T.availablePayWays(d, true).ach.why ?? "", /bank account and routing numbers in Settings/);
const unreadable = T.readInvoiceSettings({ ownBankEnc: "v1.x.y.z" });
assert.equal(unreadable.ownBankUnreadable, true); assert.equal(unreadable.ownBankLast4, null); assert.match(T.availablePayWays(unreadable, false).ach.why ?? "", /again/);
assert.equal(T.checkPayWays(["zelle", "ach"], null, T.availablePayWays(s, false)), "Add your bank account and routing numbers in Settings.", "ACH can't be chosen without its details");
assert.deepEqual(T.defaultPayWays(d, T.availablePayWays(d, false)), ["zelle"], "nothing ticked: Zelle");
assert.deepEqual(T.defaultPayWays({ payDefaults: ["check", "ach", "zelle"] }, av3), ["zelle", "ach", "check"]);
assert.deepEqual(T.defaultPayWays({ payDefaults: ["zelle", "ach", "bank"] }, T.availablePayWays(s, false)), ["zelle"], "a ticked way that lost its details is not offered");
assert.deepEqual(T.defaultPayWays({ payDefaults: ["ach"] }, T.availablePayWays(s, false)), ["zelle"], "none left: back to Zelle");
assert.deepEqual(T.readInvoiceSettings({ payDefaults: ["check", "nope", "custom", "ach", "ach"] }).payDefaults, ["ach", "check"], "unknown ways and the custom line are never defaults");
assert.ok(!(T.DEFAULTABLE_PAY_WAYS as readonly string[]).includes("custom"));
// the numbers a person types: digits, the ABA check digit, masking. The messages never repeat what was typed.
assert.equal(T.bankDigits(" 0001 2345-6789 "), "000123456789"); assert.equal(T.bankDigits("12a4"), null); assert.equal(T.bankDigits(""), null);
assert.equal(T.isRoutingNumber("000000000"), true); assert.equal(T.isRoutingNumber("011000015"), true, "a published Federal Reserve routing number passes");
assert.equal(T.isRoutingNumber("000000001"), false); assert.equal(T.isRoutingNumber("123456789"), false); assert.equal(T.isRoutingNumber("00000000"), false); assert.equal(T.isRoutingNumber("0000000000"), false);
assert.equal(T.bankDetailsProblem("000123456789", "000000000"), null); assert.equal(T.bankDetailsProblem("0001 2345 6789", "000-000-000"), null);
assert.match(T.bankDetailsProblem("000123456789", "") ?? "", /both/); assert.match(T.bankDetailsProblem("", "000000000") ?? "", /both/);
assert.match(T.bankDetailsProblem("000123456789", "000000001") ?? "", /doesn't pass the bank check/);
assert.match(T.bankDetailsProblem("000123456789", "12345678") ?? "", /exactly 9 digits/);
assert.match(T.bankDetailsProblem("12", "000000000") ?? "", /4 to 17 digits/); assert.match(T.bankDetailsProblem("acct 000123456789", "000000000") ?? "", /4 to 17 digits/);
assert.match(T.bankDetailsProblem("4242424242424242", "000000000") ?? "", /card number/, "a card number is refused in the account box too");
assert.match(T.bankDetailsProblem("000000000", "000000000") ?? "", /the same/);
for (const [a, r] of [["000123456789", "000000001"], ["000123456789", "12345678"], ["4242424242424242", "000000000"], ["00012345678X", "000000000"], ["000000000", "000000000"]] as const) {
  const why = T.bankDetailsProblem(a, r) ?? "";
  assert.ok(why && !why.includes(a) && !why.includes(r) && !/\d{4,}/.test(why), `the message never echoes a number: ${why}`);
}
assert.equal(T.accountLastDigits("000123456789"), "6789"); assert.equal(T.accountLastDigits("1234567"), "67", "a short account shows less"); assert.equal(T.maskAccountNumber("6789"), "••••6789");
assert.equal(T.bankLabelHoldsNumber("Sample Bank Checking"), false); assert.equal(T.bankLabelHoldsNumber("Sample Bank Checking 000123456789"), true); assert.equal(T.bankLabelHoldsNumber("Checking 0001 2345 6789"), true);
// everywhere else her block is still refused: the guard did not get weaker
for (const t of ["ACH to ACCT#:000123456789", "ROUTING:000000000", "Sample Bank Checking\nACH to ACCT#:000123456789\nROUTING:000000000", "acct 000123456789", "routing 000000000", "account number: 0001 2345 6789", "4242 4242 4242 4242"]) assert.equal(T.looksLikeCardOrBankNumber(t), true, `still refused in free text: ${t}`);
for (const t of ["Please send payment via Zelle to 5550100100.", "Checks Payable to Nora Chen", "Put invoice 0000170 in the Zelle memo", "Sample Bank Checking"]) assert.equal(T.looksLikeCardOrBankNumber(t), false, `not a bank number: ${t}`);

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
const doc = T.invoiceDocument(inv, { name: "Sample Bistro", billingAddress: "1 Example Ave\nSampleton, VA 23000" }, s, { stripeReady: false, payUrl: null, today: "2026-11-20", bank: null });
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
assert.deepEqual(doc.paymentLines, ["Please send payment via Zelle to (555) 010-0100.", "Put invoice 0000170 in the Zelle memo"]); assert.equal(doc.paymentMasked, false);
// all three ways: the PDF's document carries the real numbers, the team's preview the masked ones (and says so)
const inv3 = { ...inv, payWays: ["zelle" as const, "ach" as const, "check" as const] };
const pdfDoc = T.invoiceDocument(inv3, { name: "Sample Bistro", billingAddress: null }, three, { stripeReady: false, payUrl: null, today: "2026-11-20", bank: BANK });
assert.deepEqual(pdfDoc.paymentLines, T.paymentInfoLines(all3, null)); assert.equal(pdfDoc.paymentMasked, false);
const teamDoc = T.invoiceDocument(inv3, { name: "Sample Bistro", billingAddress: null }, three, { stripeReady: false, payUrl: null, today: "2026-11-20", bank: T.maskedBankDetails(three) });
assert.equal(teamDoc.paymentLines[1], "ACH to ACCT#:••••6789"); assert.equal(teamDoc.paymentMasked, true); assert.doesNotMatch(JSON.stringify(teamDoc), /000123456789/);
assert.deepEqual(doc.totals, [
  { label: "Subtotal", value: "625.10" }, { label: "Total", value: "625.10" }, { label: "Amount Paid", value: "0.00" },
  { label: "Balance Due", value: "$625.10", strong: true },
]);
assert.equal(doc.fileName, "Invoice 0000170 - Sample Bistro.pdf");
const draftDoc = T.invoiceDocument({ ...inv, number: null, status: "draft", issueDate: null, dueDate: null, discountCents: 2510, discountLabel: "Repeat", totalCents: 60000 }, { name: "Sample Bistro", billingAddress: null }, s, { stripeReady: false, payUrl: null, today: "2026-11-21", bank: null });
assert.equal(draftDoc.stamp, "DRAFT"); assert.equal(draftDoc.facts[0].value, "DRAFT"); assert.equal(draftDoc.facts[2].value, "11/21/2026");
assert.deepEqual(draftDoc.totals[1], { label: "Discount (Repeat)", value: "-25.10" }); assert.equal(draftDoc.billTo.address, null);
assert.equal(T.invoiceFileName("0000170", "SAMPLE Bakery 小点心 / Café?"), "Invoice 0000170 - SAMPLE Bakery 小点心 Café.pdf");
assert.equal(T.invoicePdfPath("inv_1"), "/invoices/inv_1/pdf"); assert.equal(T.invoicePdfPath("inv_1", { download: true }), "/invoices/inv_1/pdf?download=1");

/* the fast creator */
assert.deepEqual(T.creatorDefaultsLine({ issueDate: "2026-11-20", dueDate: "2026-11-20", payWays: ["zelle"], nextNumber: "0000170" }), { due: "Due on receipt", pay: "Zelle", number: "#0000170", text: "Due on receipt · Zelle · #0000170" });
const opt = (kind: T.BillToKind, id: string, name: string): T.BillToOption => ({ key: `${kind}:${id}`, kind, id, name, nameKey: T.customerNameKey(name), address: null, contactName: null, email: null, lang: null, customerId: kind === "customer" ? id : null, clientId: kind === "client" ? id : null, hasPastInvoices: false, hasLast: false });
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
// a monthly contract with its retainer: this month is offered only until the monthly invoices have taken it
assert.deepEqual(T.contractNextSteps(c(monthly), [], { hasRetainer: true, retainerMonth: null, today }).map((n) => n.label), ["Invoice this month"]);
assert.deepEqual(T.contractNextSteps(c(monthly), [], { hasRetainer: true, retainerMonth: today.slice(0, 7), today }), [], "the retainer took this month (its draft was deleted): not offered again");
assert.deepEqual(T.contractNextSteps(c(monthly), [], { hasRetainer: true, retainerMonth: "2026-10", today }).map((n) => n.label), ["Invoice this month"], "last month's run doesn't take this month");
assert.equal(T.contractPaymentDays({ paymentDays: "15" }), 15); assert.equal(T.contractPaymentDays({ paymentDays: "" }), 15); assert.equal(T.contractPaymentDays({ paymentDays: "400" }), T.MAX_TERMS_DAYS);
assert.equal(T.contractRefLabel({ agreementDate: "2026-11-20", createdAt: "2026-11-21T10:00:00.000Z" }), "Contract Nov 20");
assert.equal(T.contractRefLabel({ agreementDate: null, createdAt: "2026-11-21T10:00:00.000Z" }), "Contract Nov 21");

/* the text sent with the PDF (lib/invoice-copy share.pdfMessage) */
const msg = { business: "Sample Bistro", contactName: "Sam Sample", number: "0000170", amount: "$625.10", dueDate: today, dueOnReceipt: true, ach: false, zelle: "(555) 010-0100", checkPayee: null, url: null };
assert.equal(invoiceCopy("en").share.pdfMessage(msg), "Hi Sam! Here is invoice 0000170 for $625.10, due on receipt. The PDF is attached.\n\nZelle: (555) 010-0100, with 0000170 in the memo.\n\nThank you!");
assert.equal(invoiceCopy("en").share.pdfMessage({ ...msg, zelle: null, dueOnReceipt: false, dueDate: "2026-12-05", url: "https://hq.example.com/i/t" }), "Hi Sam! Here is invoice 0000170 for $625.10, due Dec 5. The PDF is attached.\n\nPay online: https://hq.example.com/i/t\n\nThank you!");
assert.match(invoiceCopy("zh-Hans").share.pdfMessage(msg), /^Sample Bistro，您好！附上账单 0000170（PDF），金额 \$625\.10，收到即付。\n\nZelle：\(555\) 010-0100，备注请写 0000170。\n\n谢谢！$/);
assert.match(invoiceCopy("zh-Hant").share.pdfMessage(msg), /帳單 0000170.*備註請寫 0000170/s);
for (const lang of ["en", "zh-Hans", "zh-Hant"] as const) assert.doesNotMatch(invoiceCopy(lang).share.pdfMessage({ ...msg, url: "https://x" }), /\u2014|fee|surcharge|手续费|手續費/i);
// the three ways: named in the PDF's order, the bank transfer pointing at the PDF (never its numbers)
const msg3 = { ...msg, ach: true, zelle: "5550100100", checkPayee: "Nora Chen" };
assert.equal(invoiceCopy("en").share.pdfMessage(msg3), "Hi Sam! Here is invoice 0000170 for $625.10, due on receipt. The PDF is attached.\n\nBank transfer (ACH): the account details are on the PDF.\nZelle: 5550100100, with 0000170 in the memo.\nChecks payable to Nora Chen.\n\nThank you!");
assert.match(invoiceCopy("zh-Hans").share.pdfMessage(msg3), /银行转账（ACH）：账户信息在 PDF 上。\nZelle：5550100100，备注请写 0000170。\n支票抬头请写 Nora Chen。/);
assert.match(invoiceCopy("zh-Hant").share.pdfMessage(msg3), /銀行轉帳（ACH）：帳戶資訊在 PDF 上。\nZelle：5550100100，備註請寫 0000170。\n支票抬頭請寫 Nora Chen。/);
for (const lang of ["en", "zh-Hans", "zh-Hant"] as const) {
  assert.doesNotMatch(invoiceCopy(lang).share.pdfMessage(msg3), /\u2014|ACCT|ROUTING|000123456789|000000000/i, "no account number can be in the message: it is not even given one");
  const page = invoiceCopy(lang).page;
  assert.ok(page.ach.title && page.ach.account && page.ach.routing, `the pay page words the bank transfer in ${lang}`);
}
assert.equal(invoiceCopy("en").page.check.payable("Nora Chen"), "Checks Payable to Nora Chen"); assert.equal(invoiceCopy("en").page.check.mailTo, "Mail to");

/* what the PDF can print (Helvetica: Western European letters only) */
assert.equal(T.pdfText("SAMPLE Bakery 小点心"), "SAMPLE Bakery"); assert.equal(T.pdfUnprintable("SAMPLE Bakery 小点心"), "小点心");
assert.equal(T.pdfText("老四川"), ""); assert.equal(T.pdfPrintsEmpty("老四川"), true); assert.equal(T.pdfPrintsEmpty("湘味轩 Xiang Wei Xuan"), false);
assert.equal(T.pdfPrintsEmpty(""), false); assert.equal(T.pdfPrintsEmpty("  "), false); assert.equal(T.pdfPrintsEmpty("Sample Bistro"), false);
assert.equal(T.pdfText("Crab O’Clock — “Café”…"), "Crab O'Clock - \"Café\"..."); assert.equal(T.pdfUnprintable("Crab O’Clock — “Café”…"), "");
assert.equal(T.pdfText("Phở 79"), "Pho 79", "an accent Helvetica lacks is dropped from its letter"); assert.equal(T.pdfUnprintable("Phở 79"), "");
assert.equal(T.pdfText("Café"), "Café", "a letter typed as letter + accent prints as the accented letter");
assert.equal(T.pdfText("Thanks!\nSee  you\tsoon \u{1F35C}"), "Thanks!\nSee you soon", "line breaks kept, runs of spaces and emoji gone"); assert.equal(T.pdfUnprintable("\u{1F35C} \u{1F35C} ok"), "\u{1F35C}", "each character once");
assert.match(T.PDF_LETTERS.leftOut("小点心"), /English letters only: 小点心 will be left out/); assert.match(T.PDF_LETTERS.name, /Add the name in English/);
for (const t of [T.PDF_LETTERS.name, T.PDF_LETTERS.customer("X"), T.PDF_LETTERS.line("x"), T.PDF_LETTERS.leftOut("x"), T.PDF_LETTERS.isLeftOut("x")]) assert.doesNotMatch(t, /—/);

/* the contract's fields as invoicing reads them (lib/contract readContractFields, used by ops-contracts too) */
const rf = readContractFields({ kind: "monthly", fee: "800", clientBusiness: "Sample Bistro", extra: "x", depositPercent: 30 });
assert.equal(rf.kind, "monthly"); assert.equal(rf.fee, "800"); assert.equal(rf.depositPercent, "", "non-strings become empty");
assert.equal((rf as Record<string, string>).extra, undefined); assert.equal(readContractFields(null).kind, "collab"); assert.equal(readContractFields({ kind: "weird" }).kind, "collab");
assert.deepEqual(Object.keys(readContractFields({})).sort(), Object.keys(defaultFields(today)).sort());

/* the email and reminder that go with the PDF (lib/payment-request buildInvoiceMessages), with the Zelle memo line */
assert.equal(formatInvoiceAmount(60000), "$600.00");
const em = buildInvoiceMessages({ businessName: "Sample Bistro", contactName: "Sam Sample", number: "0000170", totalCents: 62510, balanceCents: 62510, issueDate: today, dueDate: today, today, fromName: "Nora Chen", payLines: doc.paymentLines });
assert.equal(em.email.subject, "Invoice 0000170 from Nora Chen");
assert.equal(em.email.body, "Hi Sam,\n\nHere is invoice 0000170 for Sample Bistro: $625.10, due on receipt. The PDF is attached.\n\nHow to pay:\nPlease send payment via Zelle to (555) 010-0100.\nPut invoice 0000170 in the Zelle memo\n\nThank you so much!\nNora");
const em3 = buildInvoiceMessages({ businessName: "Sample Bistro", contactName: "Sam Sample", number: "0000170", totalCents: 62510, balanceCents: 62510, issueDate: today, dueDate: today, today, fromName: "Nora Chen", payLines: msgLines });
assert.match(em3.email.body, /How to pay:\nBank transfer \(ACH\): the account details are on the PDF\.\nPlease send payment via Zelle to 5550100100\.\nPut invoice 0000170 in the Zelle memo\nChecks Payable to Nora Chen\nMail to 100 Sample St, Sampleton, VA 23000\n\nThank you so much!/);
for (const t of [em3.email.body, em3.reminder.body, mailtoHref("sam@sample.test", em3.email)]) assert.doesNotMatch(t, /000123456789|ACCT|ROUTING/, "the email and the reminder never carry the account number");
assert.deepEqual(em.missing, []);
const late = buildInvoiceMessages({ businessName: "Sample Bistro", contactName: null, number: "0000170", totalCents: 62510, balanceCents: 42510, issueDate: "2026-11-01", dueDate: "2026-11-15", today, fromName: "Nora Chen", payLines: doc.paymentLines });
assert.equal(late.reminder.subject, "Friendly reminder: invoice 0000170 from Nora Chen");
assert.match(late.reminder.body, /^Hi there,\n\nHope you're doing well! Just a friendly reminder about invoice 0000170 for Sample Bistro: \$425\.10, which was due Nov 15, 2026\./);
assert.match(late.reminder.body, /Put invoice 0000170 in the Zelle memo/);
assert.match(buildInvoiceMessages({ businessName: "B", number: "0000171", totalCents: 100, balanceCents: 100, issueDate: today, dueDate: "2026-12-05", today, fromName: "", payLines: [] }).email.body, /due Dec 5, 2026\.[\s\S]*How to pay: \[how you'd like to be paid\]/);
assert.deepEqual(buildInvoiceMessages({ businessName: "B", number: "1", totalCents: 1, balanceCents: 1, issueDate: today, dueDate: today, today, fromName: "N", payLines: [] }).missing, ["how you get paid"]);
assert.match(mailtoHref("sam@sample.test", em.email), /^mailto:sam@sample\.test\?subject=Invoice%200000170%20from%20Nora%20Chen&body=Hi%20Sam%2C%0D%0A/);
for (const t of [em.email.body, late.reminder.body]) assert.doesNotMatch(t, /\u2014|fee|surcharge/i);

console.log("invoices-types helpers: ok");
