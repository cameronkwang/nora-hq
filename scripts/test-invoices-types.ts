/**
 * Checks for src/lib/invoices-types.ts (totals, status, numbers, money, dates, retainers, settings, the card / bank
 * number check, CSV). No test framework, just: npx tsx scripts/test-invoices-types.ts
 * Exits non-zero on the first wrong answer. The core builder extends it.
 */
import assert from "node:assert/strict";
import * as T from "../src/lib/invoices-types";
assert.equal(T.lineCents({ quantity: 1.15, unitCents: 10000 }), 11500);
assert.equal(T.lineCents({ quantity: 3, unitCents: 3333 }), 9999);
assert.deepEqual(T.invoiceTotals([{ description: "a", quantity: 2, unitCents: 25000 }, { description: "b", quantity: 1, unitCents: 10000 }], 70000), { subtotalCents: 60000, discountCents: 60000, totalCents: 0 });
assert.deepEqual(T.invoiceTotals([{ description: "a", quantity: 1, unitCents: 60000 }], 5000), { subtotalCents: 60000, discountCents: 5000, totalCents: 55000 });
assert.equal(T.isQuantity(1.5), true); assert.equal(T.isQuantity(1.005), false); assert.equal(T.isQuantity(0), false);
assert.equal(T.settledStatus("sent", 500, 0), "sent"); assert.equal(T.settledStatus("sent", 500, 200), "partially_paid"); assert.equal(T.settledStatus("partially_paid", 500, 500), "paid"); assert.equal(T.settledStatus("paid", 500, 100), "partially_paid"); assert.equal(T.settledStatus("void", 500, 500), "void");
assert.equal(T.invoiceDisplayStatus({ status: "sent", dueDate: "2026-11-19" }, "2026-11-20"), "overdue");
assert.equal(T.invoiceDisplayStatus({ status: "sent", dueDate: "2026-11-20" }, "2026-11-20"), "sent");
assert.equal(T.invoiceDisplayStatus({ status: "paid", dueDate: "2026-01-01" }, "2026-11-20"), "paid");
assert.equal(T.daysOverdue("2026-11-01", "2026-11-20"), 19); assert.equal(T.daysOverdue("2026-03-07", "2026-03-09"), 2);
assert.equal(T.formatInvoiceNumber(2026, 7), "INV-2026-0007"); assert.equal(T.formatInvoiceNumber(2026, 12345), "INV-2026-12345");
assert.deepEqual(T.parseInvoiceNumber("INV-2026-0007"), { year: 2026, seq: 7 }); assert.equal(T.parseInvoiceNumber("1043"), null);
assert.equal(T.formatCents(60000), "$600.00"); assert.equal(T.formatCents(60000, { decimals: "auto" }), "$600"); assert.equal(T.formatCents(125050, { decimals: "auto" }), "$1,250.50");
assert.equal(T.parseDollars("$1,250.50"), 125050); assert.equal(T.parseDollars("600.5"), 60050); assert.equal(T.parseDollars(" "), null);
assert.throws(() => T.parseDollars("1.234"), T.MoneyInputError); assert.throws(() => T.parseDollars("-5"), T.MoneyInputError);
assert.equal(T.centsToDollarsInput(125050), "1250.50"); assert.equal(T.centsToDollarsInput(60000), "600");
assert.equal(T.stripeFeeEstimateCents(60000, "stripe_ach"), 480); assert.equal(T.stripeFeeEstimateCents(100000, "stripe_ach"), 500); assert.equal(T.stripeFeeEstimateCents(60000, "stripe_card"), 1770);
assert.deepEqual(T.resolveInvoiceDates({ issueDate: null, dueDate: null, termsDays: 14 }, "2026-11-20"), { issueDate: "2026-11-20", dueDate: "2026-12-04" });
assert.deepEqual(T.resolveInvoiceDates({ issueDate: "2026-11-01", dueDate: null, termsDays: 30 }, "2026-11-20"), { issueDate: "2026-11-01", dueDate: "2026-12-01" });
assert.equal(T.isYmd("2026-02-30"), false); assert.equal(T.isYmd("2026-02-28"), true);
assert.equal(T.customerNameKey("Crab O' Clock, LLC"), "crab o clock llc"); assert.equal(T.customerNameKey("S&F Kingdom"), "s and f kingdom"); assert.equal(T.customerNameKey("红碗 Yummy"), "红碗 yummy");
const r = { active: true, dayOfMonth: 5, startMonth: null, lastRunMonth: null };
assert.equal(T.retainerDue(r, "2026-11-04"), false); assert.equal(T.retainerDue(r, "2026-11-05"), true); assert.equal(T.retainerDue({ ...r, lastRunMonth: "2026-11" }, "2026-11-20"), false); assert.equal(T.retainerDue({ ...r, startMonth: "2026-12" }, "2026-11-20"), false); assert.equal(T.retainerDue({ ...r, active: false }, "2026-11-20"), false);
assert.equal(T.retainerItemDescription("Social media management", "2026-11"), "Social media management (November 2026)");
assert.equal(T.looksLikeCardOrBankNumber("4242 4242 4242 4242"), true); assert.equal(T.looksLikeCardOrBankNumber("Zelle: 804-555-0123"), false);
assert.equal(T.looksLikeCardOrBankNumber("routing 021000021 account 12345678"), true); assert.equal(T.looksLikeCardOrBankNumber("Check #1043 for $600"), false);
assert.equal(T.looksLikeCardOrBankNumber("Order 1234567890123"), false); // 13 digits failing Luhn
assert.equal(T.toCsv([["Date", "Customer", "Amount"], ["2026-11-20", "=HYPERLINK(1)", -5], ["2026-11-21", 'Say "hi", ok', T.csvAmount(125050)]]), 'Date,Customer,Amount\r\n2026-11-20,\'=HYPERLINK(1),-5\r\n2026-11-21,"Say ""hi"", ok",1250.50\r\n');
const s = T.readInvoiceSettings({ line: "Zelle: x", zelle: " nora@example.com ", cardEnabled: false, termsDays: 999 });
assert.equal(s.zelle, "nora@example.com"); assert.equal(s.cardEnabled, false); assert.equal(s.achEnabled, true); assert.equal(s.termsDays, 14);
assert.deepEqual(T.payOptions(s, false).online, null); assert.deepEqual(T.payOptions(s, true).online, { ach: true, card: false });
assert.equal(T.noPayOptions(T.payOptions(T.DEFAULT_INVOICE_SETTINGS, false)), true);
console.log("invoices-types helpers: ok");
