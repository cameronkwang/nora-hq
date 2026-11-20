/**
 * lib/ops-invoices against a THROWAWAY PGlite database (never the dev data, never Neon):
 *   PGLITE_DIR=$(mktemp -d) npx tsx --require ./scripts/server-only-shim.cjs scripts/test-invoices-ops.ts
 * Covers: settings (merge, guards), the fast creator (context, Make PDF in one statement, the one-time ask, Same as
 * last time, drafts, numbering and the import race), ways to pay, payments and status, void, the deal write-through,
 * contracts both ways (deposit, the rest, monthly, retainer, contract from an invoice), retainers, reminders,
 * reports and CSV, the customer link, the Skynova import, the PDF, Claude's limits and the MCP tools' output.
 * Prints the statement count and timing of Make PDF. All values are fake. Exits non-zero on the first wrong answer.
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";

async function main() {
  const dir = process.env.PGLITE_DIR ?? "";
  if (process.env.DATABASE_URL) throw new Error("Refusing: DATABASE_URL is set. This test needs a throwaway PGlite (PGLITE_DIR=$(mktemp -d)).");
  if (!dir || /\.data[\\/]pglite\/?$/.test(dir) || (existsSync(dir) && readdirSync(dir).length > 0)) {
    throw new Error("Refusing: set PGLITE_DIR to a NEW empty folder, e.g. PGLITE_DIR=$(mktemp -d). Never the dev data in ./.data.");
  }
  delete process.env.STRIPE_SECRET_KEY; // Pay online off: Zelle and friends only
  delete process.env.APP_URL;

  const { getDb, schema } = await import("../src/lib/db");
  const ops = await import("../src/lib/ops-invoices");
  const { saveContract, listContractsWithInvoices } = await import("../src/lib/ops-contracts");
  const { savePaymentLine, getPaymentLine } = await import("../src/lib/ops-payment");
  const { today: todayNY } = await import("../src/lib/dates");
  const T = await import("../src/lib/invoices-types");
  const { defaultFields } = await import("../src/lib/contract");
  const { eq, sql } = await import("drizzle-orm");

  const NORA = "nora@local";
  const CAM = "cameron@local";
  const today = todayNY();
  const tomorrow = T.addDaysYmd(today, 1);
  const db = await getDb();
  const ok = (msg: string) => console.log(`ok  ${msg}`);
  const rejects = async (p: Promise<unknown>, re: RegExp, msg: string) => {
    await assert.rejects(p, (e: Error) => re.test(e.message), msg);
  };

  // Count statements on the PGlite client (each one is one round trip on Neon).
  const client = (db as unknown as { $client: { query: (...a: unknown[]) => Promise<unknown>; exec: (...a: unknown[]) => Promise<unknown> } }).$client;
  let statements = 0;
  for (const k of ["query", "exec"] as const) {
    const orig = client[k].bind(client);
    client[k] = (...a: unknown[]) => {
      statements++;
      return orig(...a);
    };
  }
  const count = async <R>(fn: () => Promise<R>): Promise<{ r: R; n: number; ms: number }> => {
    const before = statements;
    const t0 = performance.now();
    const r = await fn();
    return { r, n: statements - before, ms: performance.now() - t0 };
  };

  /* ── numbers and settings ── */
  assert.equal(await ops.nextInvoiceNumber(), "0000170", "fresh: first number 0000170");
  const s0 = await ops.getInvoiceSettings();
  assert.equal(s0.cardEnabled, false); assert.equal(s0.achEnabled, true); assert.equal(s0.termsDays, 0);
  assert.deepEqual(s0.savedItems.map((i) => [i.description, i.unitCents]), [["Standard Content Creation Package", 55000], ["Food Stipend", null]]);
  await savePaymentLine("Zelle: (555) 010-0100", NORA);
  await ops.saveInvoiceSettings({ footer: null, termsDays: 0 }, NORA);
  assert.equal(await getPaymentLine(), "Zelle: (555) 010-0100", "the settings merge keeps the payment line");
  await rejects(ops.saveInvoiceSettings({ checkAddress: "acct 123456789012" }, NORA), /card or bank/, "a bank account number is refused");
  await rejects(ops.saveInvoiceSettings({ zelle: "4242 4242 4242 4242" }, NORA), /card or bank/, "a card number is refused");
  await rejects(ops.saveInvoiceSettings({ zelle: "(555) 010-0100" }, "claude"), /Only Nora or Cameron/, "Claude never changes payment settings");
  await rejects(ops.setNextInvoiceNumber(500, "claude"), /Only Nora or Cameron/, "Claude never sets the number");
  ok("settings: defaults, merge with the payment line, guards");

  /* ── the creator's context, first time ── */
  const ctx0 = await ops.getInvoiceCreatorContext({ today });
  assert.equal(ctx0.nextNumber, "0000170");
  assert.deepEqual(ctx0.setupMissing, ["fromName", "fromAddress", "zelle"], "asks once: name, address, Zelle");
  assert.equal(ctx0.prefill.issueDate, today); assert.equal(ctx0.prefill.dueDate, today, "due on receipt");
  assert.deepEqual(ctx0.prefill.payWays, ["zelle"]);
  assert.equal(ctx0.payWays.card.ok, false); assert.equal(ctx0.payWays.bank.ok, false, "no Stripe: no online way");
  assert.ok(ctx0.billTo.some((o) => o.kind === "client" && o.name === "Crab O Clock"), "managed businesses are in Bill to");
  assert.ok(!ctx0.billTo.some((o) => o.id === "noraeatsgood"), "never Nora's own workspace");
  assert.equal(T.creatorDefaultsLine({ issueDate: today, dueDate: today, payWays: ctx0.prefill.payWays, nextNumber: ctx0.nextNumber }).text, "Due on receipt · Zelle · #0000170");
  ok("creator context: next 0000170, due on receipt, Zelle, the one-time ask, Bill to");

  /* ── Make PDF: a new customer, the one-time ask, her two lines ── */
  const two = [
    { description: "Standard Content Creation Package", quantity: 1, unitCents: 55000 },
    { description: "Food Stipend", quantity: 1, unitCents: 7510 },
  ];
  await rejects(ops.createAndFinalizeInvoice({ billTo: { kind: "new", name: "Sample Bistro" }, items: two }, NORA, { today }), /Zelle number/, "no Zelle number yet: refused");
  const first = await count(() => ops.createAndFinalizeInvoice({
    billTo: { kind: "new", name: "Sample Bistro", address: "1 Example Ave Ste 102\nSampleton, VA 23000", contactName: "Sam Sample", email: "sam@sample-bistro.test" },
    items: two,
    setup: { fromName: "Nora Chen", fromAddress: "100 Sample St\nSampleton, VA 23000", zelle: "(555) 010-0100" },
  }, NORA, { today }));
  const d1 = first.r;
  assert.equal(d1.number, "0000170"); assert.equal(d1.totalCents, 62510); assert.equal(d1.issueDate, today); assert.equal(d1.dueDate, today);
  assert.equal(d1.payUrl, null, "no online way: no pay link to copy");
  assert.deepEqual(d1.payWays, ["zelle"]);
  assert.equal(d1.fileName, "Invoice 0000170 - Sample Bistro.pdf");
  assert.equal(d1.pdfPath, `/invoices/${d1.id}/pdf`);
  assert.match(d1.message, /^Hi Sam! Here is invoice 0000170 for \$625\.10, due on receipt\. The PDF is attached\./);
  assert.match(d1.message, /Zelle: \(555\) 010-0100, with 0000170 in the memo\./);
  assert.match(d1.messages["zh-Hans"], /收到即付/);
  assert.deepEqual(d1.nextSteps.map((s) => s.label), ["Record payment", "Remind", "Make contract"]);
  assert.deepEqual(T.doneActions(d1, { canShareFiles: true }), ["share_pdf", "download_pdf", "copy_message"]);
  const s1 = await ops.getInvoiceSettings();
  assert.equal(s1.fromName, "Nora Chen"); assert.equal(s1.zelle, "(555) 010-0100");
  assert.equal(await getPaymentLine(), "Zelle: (555) 010-0100", "the one-time ask merged, the payment line stayed");
  assert.deepEqual((await ops.getInvoiceCreatorContext({ today })).setupMissing, [], "asked once: never again");
  const bistro = (await ops.listCustomers({ q: "Sample Bistro" }))[0];
  assert.equal(bistro.billingAddress, "1 Example Ave Ste 102\nSampleton, VA 23000");
  ok(`Make PDF (new customer + one-time ask): 0000170, $625.10, due on receipt, ${first.n} statements`);

  /* ── Make PDF for a customer who exists: the common path, timed ── */
  const runs: number[] = [];
  const counts: number[] = [];
  for (let i = 0; i < 6; i++) {
    const r = await count(() => ops.createAndFinalizeInvoice({ billTo: { kind: "customer", id: bistro.id }, items: two }, NORA, { today }));
    if (i > 0) runs.push(r.ms); // the first is the warm-up
    counts.push(r.n);
    assert.equal(r.r.number, T.formatInvoiceNumber(171 + i));
  }
  const med = [...runs].sort((a, b) => a - b)[Math.floor(runs.length / 2)];
  assert.ok(counts.every((n) => n <= 4), `common path: at most 4 statements (got ${counts.join(", ")})`);
  ok(`Make PDF, customer exists: ${counts[1]} statements, median ${med.toFixed(1)} ms over ${runs.length} warm runs (PGlite in-process): ${runs.map((x) => x.toFixed(1)).join(", ")}`);
  // The 6 above took 0000171..0000176; void the extras' noise later. "Same as last time":
  const last = await ops.lastInvoiceForCustomer(bistro.id);
  assert.ok(last);
  assert.deepEqual(last!.lines.map((l) => [l.description, l.unitCents]), [["Standard Content Creation Package", 55000], ["Food Stipend", null]], "Food Stipend comes back empty to type");
  const ctxB = await ops.getInvoiceCreatorContext({ today, customerId: bistro.id });
  assert.equal(ctxB.prefill.billTo?.customerId, bistro.id); assert.equal(ctxB.prefill.last?.lines.length, 2, "the prefill carries Same as last time");
  assert.ok(ctxB.billTo[0].customerId === bistro.id && ctxB.billTo[0].hasPastInvoices, "the most recently billed customer is first");
  ok("Same as last time: the package again, Food Stipend left empty");

  /* ── who may, and ways to pay ── */
  await rejects(ops.createAndFinalizeInvoice({ billTo: { kind: "customer", id: bistro.id }, items: two }, "claude"), /Only Nora or Cameron/, "Claude never makes the PDF");
  await rejects(ops.createAndFinalizeInvoice({ billTo: { kind: "customer", id: bistro.id }, items: two, payWays: ["zelle", "card"] }, NORA), /Stripe/, "card needs Stripe and Settings");
  await rejects(ops.createAndFinalizeInvoice({ billTo: { kind: "customer", id: bistro.id }, items: two, payWays: ["custom"] }, NORA), /Type the other way/, "custom needs its line");
  await rejects(ops.createAndFinalizeInvoice({ billTo: { kind: "customer", id: bistro.id }, items: two, payWays: ["check"] }, NORA), /checks are made out/, "check needs a payee");
  await rejects(ops.createAndFinalizeInvoice({ billTo: { kind: "customer", id: bistro.id }, items: [{ description: "Food Stipend", quantity: 1, unitCents: 0 }] }, NORA), /\$0/, "a $0 invoice is refused");
  await rejects(ops.createAndFinalizeInvoice({ billTo: { kind: "customer", id: bistro.id }, items: two, issueDate: today, dueDate: T.addDaysYmd(today, -1) }, NORA), /before the invoice date/, "due before issued");
  await rejects(ops.createAndFinalizeInvoice({ billTo: { kind: "customer", id: bistro.id }, items: two, notes: "Card 4242 4242 4242 4242" }, NORA), /card or bank/, "no card numbers in notes");
  assert.equal(await ops.nextInvoiceNumber(), "0000177", "refusals burn no number");
  const custom = await ops.createAndFinalizeInvoice({ billTo: { kind: "customer", id: bistro.id }, items: two, payWays: ["custom", "zelle"], payNote: "Cash at the shoot is fine", dueDate: T.addDaysYmd(today, 15) }, CAM, { today });
  assert.deepEqual(custom.payWays, ["zelle", "custom"], "shown Zelle first");
  assert.match(custom.message, /due [A-Z][a-z]{2} \d+\./, "a due date, not due on receipt");
  const pdfCustom = await ops.getInvoice(custom.id, { today });
  assert.deepEqual(pdfCustom!.document.paymentLines, ["(555) 010-0100 [Zelle]", "Put invoice 0000177 in the Zelle memo", "Cash at the shoot is fine"]);
  ok("ways to pay: Zelle by default, others only when available, custom line, no number burnt on refusals");

  /* ── drafts: Save as draft, then Make PDF on it; pressing again changes nothing ── */
  const draft = await ops.saveQuickDraft({ billTo: { kind: "customer", id: bistro.id }, items: two, discountCents: 1000, discountLabel: "Repeat customer", privateNotes: "SAMPLE private" }, NORA, { today });
  assert.equal(draft.created, true);
  const dRow = await ops.getInvoice(draft.id, { today });
  assert.equal(dRow!.number, null); assert.equal(dRow!.status, "draft"); assert.equal(dRow!.hasLink, false); assert.equal(dRow!.document.stamp, "DRAFT");
  const ctxD = await ops.getInvoiceCreatorContext({ today, draftId: draft.id });
  assert.equal(ctxD.prefill.draftId, draft.id); assert.equal(ctxD.prefill.discountCents, 1000); assert.equal(ctxD.prefill.privateNotes, "SAMPLE private");
  const resaved = await ops.saveQuickDraft({ billTo: { kind: "customer", id: bistro.id }, items: two, draftId: draft.id, privateNotes: "SAMPLE private" }, NORA, { today });
  assert.equal(resaved.created, false);
  assert.equal((await ops.getInvoice(draft.id))!.discountCents, 0, "a cleared discount (undefined) is cleared");
  assert.equal((await ops.getInvoice(draft.id))!.privateNotes, "SAMPLE private");
  const fromDraft = await count(() => ops.createAndFinalizeInvoice({ billTo: { kind: "customer", id: bistro.id }, items: two, draftId: draft.id, discountCents: 1000, discountLabel: "Repeat customer" }, NORA, { today }));
  assert.equal(fromDraft.r.number, "0000178"); assert.equal(fromDraft.r.id, draft.id);
  assert.equal(fromDraft.r.totalCents, 61510, "the form's discount is saved onto the draft");
  assert.equal((await ops.getInvoice(draft.id))!.privateNotes, "SAMPLE private", "fields the form didn't send are kept");
  const again = await ops.finalizeInvoice(draft.id, NORA, { today });
  assert.equal(again.first, false); assert.equal(again.invoice.number, "0000178");
  const againCreator = await ops.createAndFinalizeInvoice({ billTo: { kind: "customer", id: bistro.id }, items: two, draftId: draft.id }, NORA, { today });
  assert.equal(againCreator.number, "0000178", "Make PDF on a finalized draft returns its done state");
  assert.equal(await ops.nextInvoiceNumber(), "0000179", "pressing again burns nothing");
  await rejects(ops.deleteDraftInvoice(draft.id, NORA), /Only a draft/, "a finalized invoice is never deleted");
  ok(`drafts: no number until Make PDF (${fromDraft.n} statements), the form's discount saved, a second press changes nothing`);

  /* ── Claude's draft, finalized by a person ── */
  const cd = await ops.createInvoiceDraft({ customerId: bistro.id, items: [{ description: "Instagram Reel", quantity: 1, unitCents: 45000 }], payWays: ["zelle", "check"] }, "claude", { askId: "ask_sample" });
  assert.equal(cd.source, "claude"); assert.equal(cd.status, "draft"); assert.equal(cd.number, null); assert.deepEqual(cd.payWays, ["zelle", "check"]);
  await rejects(ops.createInvoiceDraft({ customerId: bistro.id, items: two, contractId: "ctr_x" }, "claude"), /Contracts are people only/, "Claude never links a contract");
  await rejects(ops.createInvoiceDraft({ customerId: bistro.id, items: two, payWays: ["card"] }, "claude"), /Stripe/, "Claude can't pick card while it's off");
  await rejects(ops.finalizeInvoice(cd.id, "claude"), /Only Nora or Cameron/, "Claude never finalizes");
  await rejects(ops.finalizeInvoice(cd.id, NORA, { today }), /checks are made out/, "finalize checks the ways' details");
  await ops.saveInvoiceSettings({ checkPayee: "Nora Chen", checkAddress: "100 Sample St\nSampleton, VA 23000" }, NORA);
  const fc = await ops.finalizeInvoice(cd.id, NORA, { today });
  assert.equal(fc.first, true); assert.equal(fc.invoice.number, "0000179"); assert.equal(fc.invoice.issueDate, today); assert.equal(fc.invoice.dueDate, today);
  assert.ok(fc.invoice.tokenHash, "finalizing makes the customer link");
  await rejects(ops.recordPayment(cd.id, { amountCents: 100, paidOn: today, method: "zelle" }, "claude"), /Only Nora or Cameron/, "Claude never records a payment");
  await rejects(ops.voidInvoice(cd.id, "claude"), /Only Nora or Cameron/, "Claude never voids");
  ok("Claude: drafts only (source claude, ways only as told), a person finalizes");

  /* ── the import race: a number written without moving the sequence is skipped ── */
  await db.insert(schema.invoices).values({ id: "inv_race", number: "0000180", customerId: bistro.id, status: "sent", issueDate: today, dueDate: today, items: two, subtotalCents: 62510, totalCents: 62510, source: "import", createdBy: "test" });
  assert.equal(await ops.nextInvoiceNumber(), "0000181", "peek skips a used number");
  const skip = await ops.createAndFinalizeInvoice({ billTo: { kind: "customer", id: bistro.id }, items: two }, NORA, { today });
  assert.equal(skip.number, "0000181", "never repeated");
  ok("numbering: an imported 0000180 is skipped, 0000181 taken");

  /* ── payments and status ── */
  await rejects(ops.recordPayment(d1.id, { amountCents: 70000, paidOn: today, method: "zelle" }, NORA), /more than the \$625\.10 still owed/, "above the balance is refused");
  const p1 = await ops.recordPayment(d1.id, { amountCents: 20000, paidOn: today, method: "zelle", reference: "SAMPLE-1" }, NORA);
  assert.equal(p1.invoice.status, "partially_paid"); assert.equal(p1.invoice.paidCents, 20000);
  const p2 = await ops.recordPayment(d1.id, { amountCents: 42510, paidOn: today, method: "check", reference: "Check #1001" }, CAM);
  assert.equal(p2.invoice.status, "paid"); assert.ok(p2.invoice.paidAt);
  await rejects(ops.recordPayment(d1.id, { amountCents: 1, paidOn: today, method: "zelle" }, NORA), /already paid/, "paid in full");
  await rejects(ops.updateInvoice(d1.id, { notes: "x" }, NORA), /paid/, "a paid invoice isn't edited");
  const back = await ops.deletePayment(p2.payment.id, NORA);
  assert.equal(back.status, "partially_paid"); assert.equal(back.paidAt, null);
  await rejects(ops.voidInvoice(d1.id, NORA), /payments/, "void needs no payments");
  await rejects(ops.updateInvoice(d1.id, { items: [{ description: "Food Stipend", quantity: 1, unitCents: 10000 }] }, NORA), /below what's already paid/, "total can't go below paid");
  const edited = await ops.updateInvoice(d1.id, { items: [{ description: "Standard Content Creation Package", quantity: 1, unitCents: 20000 }] }, NORA);
  assert.equal(edited.status, "paid", "editing the total down to what's paid makes it paid");
  await rejects(ops.recordPayment(dRow!.id, { amountCents: -5, paidOn: today, method: "zelle" }, NORA), /amount|Too small|>=/i, "a negative amount is refused");
  ok("payments: partial, paid, delete → back, edit recomputes the status, refusals");

  /* ── void, link, public page ── */
  const toVoid = await ops.createAndFinalizeInvoice({ billTo: { kind: "customer", id: bistro.id }, items: two }, NORA, { today });
  const link = await ops.getInvoiceLink(toVoid.id, NORA, { origin: "http://localhost:3200" });
  assert.match(link ?? "", /^http:\/\/localhost:3200\/i\/[A-Za-z0-9_-]{43}$/);
  await rejects(ops.getInvoiceLink(toVoid.id, "claude"), /Only Nora or Cameron/, "Claude never gets a link");
  const token = link!.split("/i/")[1];
  const pub = await ops.getInvoiceByToken(token, { today });
  assert.equal(pub.state, "open");
  if (pub.state === "open") {
    assert.equal(pub.invoice.number, toVoid.number); assert.equal(pub.invoice.balanceCents, 62510);
    assert.deepEqual(pub.options.map((o) => o.way), ["zelle"], "exactly its ways");
    assert.equal(JSON.stringify(pub).includes("privateNotes"), false);
  }
  await ops.markInvoiceViewed(toVoid.id);
  const v1 = (await ops.getInvoice(toVoid.id))!.viewedAt;
  await ops.markInvoiceViewed(toVoid.id);
  assert.equal((await ops.getInvoice(toVoid.id))!.viewedAt?.getTime(), v1?.getTime(), "first view kept");
  assert.equal((await ops.getInvoiceByToken("not-a-token")).state, "unknown");
  assert.equal((await ops.getInvoiceByToken("A".repeat(43))).state, "unknown");
  const newLink = await ops.replaceInvoiceLink(toVoid.id, NORA);
  assert.equal((await ops.getInvoiceByToken(token)).state, "unknown", "the old link stops working");
  assert.equal((await ops.getInvoiceByToken(newLink.split("/i/")[1])).state, "open");
  const voided = await ops.voidInvoice(toVoid.id, NORA, { reason: "Made twice (SAMPLE)" });
  assert.equal(voided.status, "void"); assert.equal(voided.number, toVoid.number, "keeps its number");
  assert.equal((await ops.getInvoiceByToken(newLink.split("/i/")[1])).state, "void");
  assert.equal(await ops.invoicePdf(toVoid.id, { public: true }), null, "public PDF of a void invoice: none");
  ok("link: copy, view once, new link, void → cancelled page");

  /* ── PDF ── */
  const pdf = await count(() => ops.invoicePdf(d1.id, { today }));
  assert.ok(pdf.r); assert.equal(Buffer.from(pdf.r!.bytes.slice(0, 5)).toString(), "%PDF-");
  assert.equal(pdf.r!.filename, "Invoice 0000170 - Sample Bistro.pdf");
  assert.equal(await ops.invoicePdf(cd.id, { public: true }) !== null, true, "a finalized invoice's public PDF");
  const pdfTimes: number[] = [];
  for (let i = 0; i < 5; i++) pdfTimes.push((await count(() => ops.invoicePdf(d1.id, { today }))).ms);
  ok(`PDF: ${pdf.n} statements, ${pdfTimes.map((x) => x.toFixed(1)).join(", ")} ms`);

  /* ── overdue and due tomorrow, reminders ── */
  const late = await ops.createAndFinalizeInvoice({ billTo: { kind: "client", id: "crab-o-clock" }, items: [{ description: "Social media services (SAMPLE)", quantity: 1, unitCents: 80000 }], issueDate: T.addDaysYmd(today, -20), dueDate: T.addDaysYmd(today, -6) }, NORA, { today });
  const soon = await ops.createAndFinalizeInvoice({ billTo: { kind: "client", id: "crab-o-clock" }, items: [{ description: "Social media services (SAMPLE)", quantity: 1, unitCents: 30000 }], dueDate: tomorrow }, NORA, { today });
  const crab = (await ops.listCustomers({ q: "Crab" }))[0];
  assert.equal(crab.clientId, "crab-o-clock"); assert.equal(crab.source, "client");
  const overdueList = await ops.listInvoices({ status: "overdue", today });
  assert.deepEqual(overdueList.map((i) => i.id), [late.id]); assert.equal(overdueList[0].daysOverdue, 6);
  const rem = await ops.invoiceReminders(today);
  assert.deepEqual(rem.overdue.map((i) => i.id), [late.id]); assert.deepEqual(rem.dueTomorrow.map((i) => i.id), [soon.id]);
  ok("overdue (derived) and due tomorrow in the reminders");

  /* ── deals: prefill, write-through both ways ── */
  await db.insert(schema.deals).values({ id: "deal_sample", businessName: "Sample Pizzeria", contactName: "Pat Sample", contactEmail: "owner@sample-pizzeria.test", address: "2 Example Ave, Sampleton, VA 23000", compType: "paid", amountCents: 50000, status: "posted", createdBy: "test" });
  await db.insert(schema.dealDeliverables).values([{ id: "dd1", dealId: "deal_sample", kind: "ig_reel", sortOrder: 0 }, { id: "dd2", dealId: "deal_sample", kind: "tiktok", sortOrder: 1 }]);
  const ctxDeal = await ops.getInvoiceCreatorContext({ today, dealId: "deal_sample" });
  assert.equal(ctxDeal.prefill.source, "deal"); assert.equal(ctxDeal.prefill.billTo?.kind, "deal");
  assert.deepEqual(ctxDeal.prefill.lines.map((l) => [l.description, l.unitCents]), [["Collab: Instagram Reel, TikTok", 50000]]);
  const dealInv = await ops.createAndFinalizeInvoice({ billTo: { kind: "deal", id: "deal_sample" }, items: [{ description: "Collab: Instagram Reel, TikTok", quantity: 1, unitCents: 50000 }], dueDate: T.addDaysYmd(today, 14) }, NORA, { today });
  const dealRow = async () => (await db.select().from(schema.deals).where(eq(schema.deals.id, "deal_sample")))[0];
  assert.equal((await dealRow()).paymentStatus, "requested"); assert.equal((await dealRow()).paymentDueDate, T.addDaysYmd(today, 14));
  const fromDealClaude = await ops.createInvoiceFromDeal("deal_sample", "claude");
  assert.deepEqual(fromDealClaude, { id: dealInv.id, created: false }, "a deal with an open invoice returns it");
  const dp = await ops.recordPayment(dealInv.id, { amountCents: 50000, paidOn: today, method: "zelle" }, NORA);
  assert.equal(dp.invoice.status, "paid"); assert.equal((await dealRow()).paymentStatus, "paid");
  await ops.deletePayment(dp.payment.id, NORA);
  assert.equal((await dealRow()).paymentStatus, "requested", "deleting the payment moves the deal back");
  await ops.voidInvoice(dealInv.id, NORA);
  assert.equal((await dealRow()).paymentStatus, "not_requested", "no invoice left: back to not requested");
  assert.equal((await ops.invoicesForDeal("deal_sample")).length, 0, "void left out");
  ok("deals: prefill from the deal, requested → paid → requested → not requested");

  /* ── contracts → invoice (deposit, then the rest) ── */
  const pizzaFields = { ...defaultFields(today), clientBusiness: "Sample Pizzeria", clientContact: "Pat Sample", clientEmail: "owner@sample-pizzeria.test", fee: "450", depositPercent: "30", paymentDays: "15" };
  const ctrId = await saveContract({ fields: pizzaFields, dealId: "deal_sample" }, NORA);
  const pre1 = await ops.invoicePrefillFromContract(ctrId, { today });
  assert.ok(pre1); assert.equal(pre1!.contractPart, "deposit"); assert.equal(pre1!.contractId, ctrId); assert.equal(pre1!.dealId, "deal_sample");
  assert.deepEqual(pre1!.lines.map((l) => [l.description, l.unitCents]), [["Deposit (30%)", 13500]]); assert.equal(pre1!.dueDate, today, "deposit due on signing");
  assert.ok(pre1!.billTo, "the deal's business is matched by name"); assert.match(pre1!.note ?? "", /The deposit for the Sample Pizzeria contract/);
  const dep = await ops.createAndFinalizeInvoice({ billTo: { kind: pre1!.billTo!.kind, id: pre1!.billTo!.id }, items: [{ description: "Deposit (30%)", quantity: 1, unitCents: 13500 }], contractId: ctrId, dealId: "deal_sample", dueDate: pre1!.dueDate }, NORA, { today });
  const ctrRow = async () => (await db.select().from(schema.contracts).where(eq(schema.contracts.id, ctrId)))[0];
  assert.equal((await ctrRow()).customerId, dep.customerId, "the contract now knows its customer");
  assert.deepEqual(dep.nextSteps.map((s) => s.label), ["Record payment", "Remind"], "has a contract: no Make contract");
  const pre2 = await ops.invoicePrefillFromContract(ctrId, { today, part: "rest" });
  assert.equal(pre2!.contractPart, "rest"); assert.deepEqual(pre2!.lines.map((l) => [l.description, l.unitCents]), [["Standard Content Creation Package, remaining 70%", 31500]]);
  assert.equal(pre2!.dueDate, T.addDaysYmd(today, 15)); assert.equal(pre2!.billTo?.customerId, dep.customerId);
  const refs = await ops.invoicesForContracts([ctrId, "ctr_none"], { today });
  assert.deepEqual(refs[ctrId].map((r) => T.invoiceRefLabel(r)), [`${dep.number} · Sent`]); assert.equal(refs.ctr_none, undefined);
  const hist = await listContractsWithInvoices(50, { today });
  assert.deepEqual(hist.find((c) => c.id === ctrId)!.nextSteps.map((s) => s.label), ["Invoice the rest"]);
  const cref = await ops.contractForInvoice(dep.id);
  assert.equal(cref?.id, ctrId); assert.equal(T.contractRefLabel(cref!), `Contract ${T.shortDate(today)}`);
  assert.ok((await ops.contractsForCustomer(dep.customerId)).some((c) => c.id === ctrId));
  assert.ok((await ops.contractsForDeal("deal_sample")).some((c) => c.id === ctrId));
  const cust = await ops.getCustomer(dep.customerId, { today });
  assert.equal(cust!.contracts[0].id, ctrId); assert.deepEqual(cust!.contracts[0].nextSteps.map((s) => s.label), ["Invoice the rest"]);
  const restInv = await ops.createAndFinalizeInvoice({ billTo: { kind: "customer", id: dep.customerId }, items: pre2!.lines.map((l) => ({ description: l.description, quantity: 1, unitCents: l.unitCents! })), contractId: ctrId, dueDate: pre2!.dueDate }, NORA, { today });
  assert.equal(await ops.invoicePrefillFromContract(ctrId, { today }), null, "fully invoiced: nothing left");
  assert.deepEqual((await listContractsWithInvoices(50, { today })).find((c) => c.id === ctrId)!.nextSteps, []);
  assert.equal((await dealRow()).paymentStatus, "requested", "the contract's invoices follow the deal too");
  void restInv;
  ok("contract → invoice: deposit (30%, due on signing), the rest (due in 15 days), each shows the other");

  /* ── invoice → contract, and the contract links back ── */
  const cp = await ops.contractPrefillFromInvoice(d1.id, { today });
  assert.equal(cp!.fields.clientBusiness, "Sample Bistro"); assert.equal(cp!.fields.clientContact, "Sam Sample"); assert.equal(cp!.fields.fee, "200", "the fee from the main line");
  const linked = await saveContract({ fields: { ...defaultFields(today), ...cp!.fields }, invoiceId: d1.id }, NORA);
  assert.equal((await ops.getInvoice(d1.id))!.contract?.id, linked, "the saved contract links back");
  assert.deepEqual((await ops.getInvoice(d1.id))!.nextSteps.map((s) => s.label).includes("Make contract"), false);
  await rejects(ops.linkContractToInvoice(linked, d1.id, "claude"), /Only Nora or Cameron/, "Claude never links contracts");
  ok("invoice → contract: prefilled, saved, linked back");

  /* ── monthly contract: invoice this month, monthly invoices (a retainer) ── */
  const monthly = await saveContract({ fields: { ...defaultFields(today), kind: "monthly", clientBusiness: "SNF Kingdom", clientContact: "SAMPLE Manager", fee: "600", startDate: today, paymentDays: "10" } }, NORA);
  const pm = await ops.invoicePrefillFromContract(monthly, { today });
  assert.equal(pm!.contractPart, "month"); assert.equal(pm!.lines[0].description, T.retainerItemDescription("Social media services", today.slice(0, 7)));
  assert.equal(pm!.billTo?.kind, "client", "the managed business SNF Kingdom is matched");
  const mInv = await ops.createAndFinalizeInvoice({ billTo: { kind: "client", id: "snf-kingdom" }, items: [{ description: pm!.lines[0].description, quantity: 1, unitCents: 60000 }], contractId: monthly, dueDate: pm!.dueDate }, NORA, { today });
  const ret = await ops.createRetainerFromContract(monthly, NORA, { today });
  assert.equal(ret.created, true); assert.equal(ret.retainer.amountCents, 60000); assert.equal(ret.retainer.contractId, monthly);
  assert.equal(ret.retainer.lastRunMonth, today.slice(0, 7), "this month is already invoiced: not billed twice");
  assert.equal(ret.retainer.customerId, mInv.customerId);
  assert.equal((await ops.createRetainerFromContract(monthly, NORA, { today })).created, false, "one per contract");
  await rejects(ops.createRetainerFromContract(ctrId, NORA, { today }), /monthly contract/, "a collab can't bill monthly");
  ok("monthly contract: this month's invoice, then monthly invoices without double billing");

  /* ── retainers: one draft per customer per month, idempotent ── */
  const r1 = await ops.createRetainer({ customerId: bistro.id, description: "Social media services", amountCents: 80000, dayOfMonth: 1 }, NORA);
  const now = new Date(`${today}T15:00:00Z`);
  const dry = await ops.runRetainers(now, { dryRun: true });
  assert.ok(dry.created.some((c) => c.retainerId === r1.id && c.invoiceId === ""), "the preview lists it and makes nothing");
  assert.equal((await ops.listInvoices({ status: "draft" })).filter((i) => i.source === "retainer").length, 0);
  const run1 = await ops.runRetainers(now);
  const made = run1.created.find((c) => c.retainerId === r1.id);
  assert.ok(made && made.invoiceId); assert.equal(run1.failed, 0);
  assert.ok(!run1.created.some((c) => c.retainerId === ret.retainer.id), "the contract's month was already billed");
  const rd = await ops.getInvoice(made!.invoiceId);
  assert.equal(rd!.status, "draft"); assert.equal(rd!.items[0].description, T.retainerItemDescription("Social media services", today.slice(0, 7))); assert.deepEqual(rd!.payWays, ["zelle"]);
  assert.equal((await ops.runRetainers(now)).created.length, 0, "a second run makes nothing");
  await ops.deleteDraftInvoice(made!.invoiceId, NORA);
  assert.equal((await ops.runRetainers(now)).created.length, 0, "a deleted draft isn't made again this month");
  const rem2 = await ops.invoiceReminders(today, run1);
  assert.equal(rem2.readyToSend.length, 0, "the deleted draft isn't announced");
  ok("retainers: preview, one draft, idempotent, deleted stays deleted");

  /* ── reminders preview (the daily push), with retainers first ── */
  const { runDailyReminders } = await import("../src/lib/ops-notify");
  await ops.updateRetainer(r1.id, { dayOfMonth: 1 }, NORA);
  await db.update(schema.retainers).set({ lastRunMonth: null }).where(eq(schema.retainers.id, r1.id));
  const prev = await runDailyReminders(now, { preview: true }) as { messages?: Array<{ title: string; body: string; url: string }> };
  const titles = (prev.messages ?? []).map((m) => m.title);
  assert.ok(titles.some((t) => /payments? overdue/i.test(t)), `overdue push (${titles.join(" | ")})`);
  assert.ok(titles.some((t) => t.startsWith("Due tomorrow: Crab O Clock")), "due tomorrow push");
  assert.ok(titles.some((t) => t.startsWith("Invoice ready: Sample Bistro")), "retainer ready push (preview)");
  assert.equal((await ops.listInvoices({ status: "draft" })).filter((i) => i.source === "retainer").length, 0, "the preview made nothing");
  ok(`daily reminders preview: ${titles.join(" | ")}`);

  /* ── reports and CSV ── */
  const rep = await ops.invoiceReport({ today });
  assert.ok(rep.outstandingCents > 0 && rep.overdueCents === 80000 && rep.overdueCount === 1);
  assert.equal(rep.paidThisYearCents, 20000, "cash basis: the one payment left");
  assert.equal(rep.paidByMonth.length, 12); assert.deepEqual(rep.byMethodThisYear, [{ method: "zelle", cents: 20000 }]);
  const csv = await ops.paymentsCsv({ year: Number(today.slice(0, 4)) });
  const lines = csv.csv.trim().split("\r\n");
  assert.equal(lines[0], "Date,Invoice,Customer,Method,Reference,Amount,Stripe fee,Net");
  assert.equal(lines[1], `${today},0000170,Sample Bistro,Zelle,SAMPLE-1,200.00,,200.00`);
  ok("reports: outstanding, overdue, paid (cash basis); CSV for taxes");

  /* ── Skynova import: preview, save, numbers moved past ── */
  const paste = [
    "Invoice #\tCustomer\tInvoice Date\tDue Date\tTotal\tAmount Paid\tBalance Due\tStatus",
    "0000168\tSample Bistro\t10/01/2026\t10/01/2026\t$550.00\t$550.00\t$0.00\tPaid",
    "190\tSAMPLE Noodle House\tOct 5, 2026\tOct 20, 2026\t$1,250.50\t$250.50\t$1,000.00\tPartially Paid",
    "0000170\tSample Bistro\t11/20/2026\t11/20/2026\t$625.10\t$0.00\t$625.10\tUnpaid",
    "SKY-12\tSAMPLE Card Person\t11/01/2026\t\t4242 4242 4242 4242\t\t\tUnpaid",
    "Total\t\t\t\t$2,425.60",
  ].join("\n");
  const prevImp = await ops.previewSkynovaImport(paste, "invoices");
  assert.deepEqual(prevImp.invoices.map((r) => r.number), ["0000168", "0000190", "0000170", "SKY-12"]);
  assert.equal(prevImp.invoices[0].existingCustomerId, bistro.id, "matched by name");
  assert.equal(prevImp.invoices[2].existingInvoiceId, d1.id, "already here (same number)");
  assert.ok(prevImp.invoices[3].issues.includes("card or bank number in the text"));
  assert.deepEqual(prevImp.skipped.map((s) => s.reason), ["Totals row"]);
  await rejects(ops.saveSkynovaImport(paste, "invoices", "claude"), /Only Nora or Cameron/, "Claude never imports");
  const imp = await ops.saveSkynovaImport(paste, "invoices", NORA);
  assert.equal(imp.invoicesCreated, 2); assert.equal(imp.paymentsCreated, 2); assert.equal(imp.customersCreated, 1);
  assert.equal(imp.nextNumber, "0000191", "the sequence moved past the imported 0000190");
  const noodle = (await ops.listInvoices({ q: "Noodle" }))[0];
  assert.equal(noodle.status, "partially_paid"); assert.equal(noodle.balanceCents, 100000); assert.equal(noodle.source, "import");
  assert.equal((await ops.listInvoices({ q: "0000168" }))[0].status, "paid");
  const again2 = await ops.saveSkynovaImport(paste, "invoices", NORA);
  assert.equal(again2.invoicesCreated, 0, "importing twice adds nothing");
  const next191 = await ops.createAndFinalizeInvoice({ billTo: { kind: "customer", id: bistro.id }, items: two }, NORA, { today });
  assert.equal(next191.number, "0000191");
  const cImp = await ops.saveSkynovaImport("Customer,Email,Phone,Address,City,State,Zip\nSAMPLE Noodle House,noodle@sample.test,555-0102,3 Example Rd,Sampleton,VA,23000\nSAMPLE Tea Bar,tea@sample.test,,,,,\n", "customers", NORA);
  assert.deepEqual([cImp.customersCreated, cImp.customersMatched], [1, 1], "matched by name key, never duplicated");
  const noodleC = (await ops.listCustomers({ q: "Noodle" }))[0];
  assert.equal(noodleC.email, "noodle@sample.test"); assert.equal(noodleC.billingAddress, "3 Example Rd\nSampleton, VA 23000", "blanks filled in");
  ok(`Skynova import: preview marks matches and issues, save keeps numbers, next is ${imp.nextNumber}`);

  /* ── Next invoice number: up, never back onto a used one ── */
  assert.equal(await ops.setNextInvoiceNumber(100, NORA), "0000192", "floored past every used number");
  assert.equal(await ops.setNextInvoiceNumber(500, CAM), "0000500");
  assert.equal((await ops.createAndFinalizeInvoice({ billTo: { kind: "customer", id: bistro.id }, items: two }, NORA, { today })).number, "0000500");
  ok("next invoice number: skip ahead, never back");

  /* ── saved lines ── */
  const saved = await ops.saveSavedItems([{ id: "package", description: "Standard Content Creation Package", unitCents: 60000 }, { description: "Food Stipend", unitCents: null }, { description: "Extra Reel", unitCents: 15000 }], NORA);
  assert.equal(saved.length, 3); assert.equal(saved[0].unitCents, 60000); assert.ok(saved[2].id.startsWith("item_"));
  assert.equal((await ops.getInvoiceCreatorContext({ today })).savedItems.length, 3);
  await rejects(ops.saveSavedItems([], "claude"), /Only Nora or Cameron/, "Claude never edits saved lines");
  ok("saved lines: edited, new ids, people only");

  /* ── customers: delete only without invoices ── */
  await rejects(ops.deleteCustomer(bistro.id, NORA), /has invoices/, "a customer with invoices is archived, not deleted");
  const tea = (await ops.listCustomers({ q: "Tea Bar" }))[0];
  await ops.deleteCustomer(tea.id, NORA);
  assert.equal((await ops.listCustomers({ q: "Tea Bar" })).length, 0);
  await ops.setCustomerArchived(noodleC.id, true, NORA);
  assert.equal((await ops.listCustomers({ q: "Noodle" })).length, 0); assert.equal((await ops.listCustomers({ q: "Noodle", includeArchived: true })).length, 1);
  ok("customers: delete without invoices, archive with");

  /* ── a customer typed or imported before their business was linked becomes that business's customer ── */
  const maxs = await ops.createCustomer({ name: "Max's (Virginia Beach)", email: "max@sample.test" }, NORA);
  const linkedMax = await ops.customerForClient("maxs-virginia-beach", NORA);
  assert.equal(linkedMax.id, maxs.id, "matched by name, not duplicated"); assert.equal(linkedMax.clientId, "maxs-virginia-beach");
  assert.equal((await ops.customerForClient("maxs-virginia-beach", "claude")).id, maxs.id, "one customer per business");
  await rejects(ops.customerForClient("noraeatsgood", NORA), /Nora's own workspace/, "never Nora's creator workspace");
  await rejects(ops.createCustomer({ name: "X", clientId: "maxs-virginia-beach" }, NORA), /already the customer/, "a business has one customer");
  ok("customers: a same-name customer is linked to its business, one per business");

  /* ── the creator's one call: statements and time ── */
  const ctxRuns: number[] = [];
  let ctxStatements = 0;
  for (let i = 0; i < 6; i++) {
    const r = await count(() => ops.getInvoiceCreatorContext({ today, customerId: bistro.id }));
    if (i > 0) ctxRuns.push(r.ms);
    ctxStatements = r.n;
  }
  ok(`creator context (?customer=): ${ctxStatements} reads in parallel, ${ctxRuns.map((x) => x.toFixed(1)).join(", ")} ms`);

  /* ── Claude's tools: what they return ── */
  const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
  const { registerInvoiceTools } = await import("../src/lib/mcp/tools-invoices");
  const server = new McpServer({ name: "test", version: "0" });
  registerInvoiceTools(server);
  const tools = (server as unknown as { _registeredTools: Record<string, { handler?: (a: unknown, e: unknown) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>; callback?: (a: unknown, e: unknown) => Promise<{ content: Array<{ text: string }>; isError?: boolean }> }> })._registeredTools;
  const call = async (name: string, args: unknown) => {
    const t = tools[name];
    const fn = t.handler ?? t.callback;
    const out = await fn!(args, {});
    return { text: out.content[0].text, error: !!out.isError };
  };
  const all = [await call("list_invoices", {}), await call("get_invoice", { id: dep.id }), await call("list_customers", {}), await call("get_invoice", { id: d1.id })];
  for (const o of all) {
    assert.equal(o.error, false, o.text);
    assert.doesNotMatch(o.text, /token|tokenHash|tokenEnc|stripe|ctr_|contract/i, `no links, Stripe or contracts in Claude's output: ${o.text.slice(0, 120)}`);
    assert.doesNotMatch(o.text, /\/i\//, "never a customer link");
  }
  const mk = await call("create_draft_invoice", { client_id: "poke-bros", lines: [{ description: "Instagram Reel", unit_cents: 45000 }], pay_ways: ["zelle"] });
  assert.equal(mk.error, false, mk.text); assert.match(mk.text, /"status":"draft"/);
  const bad = await call("create_draft_invoice", { client_id: "poke-bros", lines: [{ description: "x", unit_cents: 100 }], pay_ways: ["card"] });
  assert.equal(bad.error, true);
  const twoWho = await call("create_draft_invoice", { client_id: "poke-bros", customer_id: bistro.id, lines: [{ description: "x", unit_cents: 100 }] });
  assert.equal(twoWho.error, true);
  ok("MCP: reads without links / Stripe / contracts; create_draft_invoice makes a draft, refuses card");

  /* ── activity log: never an amount, a link or the Zelle number ── */
  const acts = await db.select({ s: schema.activity.summary }).from(schema.activity).where(sql`${schema.activity.action} like 'invoice%' or ${schema.activity.action} like 'customer%' or ${schema.activity.action} like 'retainer%'`);
  for (const a of acts) assert.doesNotMatch(a.s, /\$\d|\/i\/|010-0100/, `activity "${a.s}"`);
  ok(`activity: ${acts.length} invoicing entries, none with an amount, link or Zelle number`);

  console.log("all invoicing ops checks passed");
}

main().then(() => process.exit(0), (e) => {
  console.error(e);
  process.exit(1);
});
