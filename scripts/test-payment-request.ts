/**
 * Checks for src/lib/payment-request.ts — no test framework, just: npx tsx scripts/test-payment-request.ts
 * Exits non-zero on the first wrong answer.
 */
import assert from "node:assert/strict";
import { AMOUNT_PLACEHOLDER, PAY_PLACEHOLDER, buildPaymentRequest, formatAmount, longDate, mailtoHref, type PaymentRequestInput } from "../src/lib/payment-request";

const base: PaymentRequestInput = {
  businessName: "Crab O Clock",
  contactName: "Maria Lopez",
  amountCents: 60000,
  deliverables: [
    { label: "Instagram Reel", postUrl: "https://www.instagram.com/reel/abc123/" },
    { label: "TikTok", postedOn: "2026-11-10" },
    { label: "Instagram Stories", dueDate: "2026-11-20" },
  ],
  visitDate: "2026-11-04",
  dueDate: "2026-11-28",
  paymentLine: "Zelle: 804-555-0123",
  fromName: "Nora",
  fromHandle: "@noraeatsgood",
  today: "2026-11-14",
};

/* ── helpers ── */
assert.equal(formatAmount(60000), "$600");
assert.equal(formatAmount(125050), "$1,250.50");
assert.equal(longDate("2026-11-28"), "Nov 28, 2026");
assert.equal(longDate("soon"), "soon");

/* ── invoice: everything set ── */
{
  const r = buildPaymentRequest(base);
  assert.deepEqual(r.missing, []);
  assert.equal(r.invoice.subject, "Invoice from Nora for Crab O Clock ($600)");
  assert.equal(
    r.invoice.body,
    [
      "Hi Maria,",
      "",
      "Thank you for having me at Crab O Clock! Here is my invoice for our collab.",
      "",
      "INVOICE",
      "From: Nora (@noraeatsgood)",
      "For: Crab O Clock",
      "Date: Nov 14, 2026",
      "Visit: Nov 4, 2026",
      "",
      "Deliverables",
      "- Instagram Reel: https://www.instagram.com/reel/abc123/",
      "- TikTok: posted Nov 10, 2026",
      "- Instagram Stories: coming by Nov 20, 2026",
      "",
      "Amount due: $600",
      "Due by: Nov 28, 2026",
      "How to pay: Zelle: 804-555-0123",
      "",
      "Thank you so much!",
      "Nora",
    ].join("\n"),
  );
}

/* ── reminder: not due yet, some posted ── */
{
  const r = buildPaymentRequest(base);
  assert.equal(r.reminder.subject, "Friendly reminder: invoice from Nora for Crab O Clock ($600)");
  assert.match(r.reminder.body, /invoice for our collab at Crab O Clock: \$600, due Nov 28, 2026\./);
  assert.match(r.reminder.body, /Here's what's posted so far:\n- Instagram Reel: https:\/\/www\.instagram\.com\/reel\/abc123\/\n- TikTok: posted Nov 10, 2026\n/);
  assert.ok(!r.reminder.body.includes("Instagram Stories"), "unposted deliverables stay out of the reminder");
  assert.match(r.reminder.body, /How to pay: Zelle: 804-555-0123/);
  assert.ok(r.reminder.body.endsWith("Thank you!\nNora"));
}

/* ── reminder: overdue, everything posted ── */
{
  const r = buildPaymentRequest({ ...base, today: "2026-12-05", deliverables: base.deliverables.slice(0, 2) });
  assert.match(r.reminder.body, /\$600, which was due Nov 28, 2026\./);
  assert.match(r.reminder.body, /Everything is posted:/);
}

/* ── gaps become placeholders and are listed ── */
{
  const r = buildPaymentRequest({ ...base, amountCents: null, paymentLine: "  ", contactName: null, dueDate: null, visitDate: null, deliverables: [], fromHandle: null });
  assert.deepEqual(r.missing, ["the fee", "how you get paid"]);
  assert.ok(r.invoice.body.startsWith("Hi there,"));
  assert.ok(r.invoice.body.includes(`Amount due: ${AMOUNT_PLACEHOLDER}`));
  assert.ok(r.invoice.body.includes(`How to pay: ${PAY_PLACEHOLDER}`));
  assert.ok(r.invoice.body.includes("From: Nora\n"));
  assert.ok(!r.invoice.body.includes("Due by:"));
  assert.ok(!r.invoice.body.includes("Visit:"));
  assert.ok(!r.invoice.body.includes("Deliverables"));
  assert.equal(r.invoice.subject, "Invoice from Nora for Crab O Clock");
  assert.ok(r.reminder.body.includes(`Crab O Clock: ${AMOUNT_PLACEHOLDER}.`));
  assert.ok(!r.reminder.body.includes("posted"));
}

/* ── a $0 fee counts as "not set"; odd contact names fall back to "there" ── */
{
  const r = buildPaymentRequest({ ...base, amountCents: 0, contactName: "804-555-0199" });
  assert.deepEqual(r.missing, ["the fee"]);
  assert.ok(r.invoice.body.startsWith("Hi there,"));
}

/* ── text typed into the deal can't break the layout ── */
{
  const r = buildPaymentRequest({ ...base, businessName: "Crab\nO  Clock", paymentLine: "Zelle:\n804-555-0123", deliverables: [{ label: "Photos" }] });
  assert.ok(r.invoice.body.includes("For: Crab O Clock\n"));
  assert.ok(r.invoice.body.includes("How to pay: Zelle: 804-555-0123\n"));
  assert.ok(r.invoice.body.includes("- Photos: coming soon"));
}

/* ── mailto ── */
{
  const r = buildPaymentRequest(base);
  const href = mailtoHref("maria@craboclock.com", r.invoice);
  assert.ok(href.startsWith("mailto:maria@craboclock.com?subject=Invoice%20from%20Nora%20for%20Crab%20O%20Clock%20(%24600)&body=Hi%20Maria%2C%0D%0A%0D%0AThank"));
  assert.ok(!/[\r\n]/.test(href));
  const u = new URL(href);
  assert.equal(u.searchParams.get("body"), r.invoice.body.replace(/\n/g, "\r\n"));
  // No address, or something that isn't one: the mail app opens with a blank recipient.
  assert.ok(mailtoHref(null, r.invoice).startsWith("mailto:?subject="));
  assert.ok(mailtoHref("not an email?cc=x@y.com", r.invoice).startsWith("mailto:?subject="));
  assert.ok(mailtoHref("a@b.com?bcc=evil@x.com", r.invoice).startsWith("mailto:?subject="));
}

console.log("payment-request: all checks passed");
