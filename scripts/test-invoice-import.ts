/**
 * Checks for src/lib/invoice-import.ts, the Skynova paste / CSV parser (pure: no database). Run:
 *   npx tsx scripts/test-invoice-import.ts
 * The server half (matching existing customers and numbers, saving, moving the number sequence) is in
 * scripts/test-invoices-ops.ts. Exits non-zero on the first wrong answer. All values are fake.
 */
import assert from "node:assert/strict";
import { cleanCell, detectDelimiter, headerKey, importedLine, parseImport, parseImportAmount, parseImportDate, splitRecords, IMPORT_MAX_ROWS } from "../src/lib/invoice-import";

/* cells, delimiters, quotes */
assert.equal(cleanCell(" a​\tb c  "), "a b c");
assert.equal(detectDelimiter("Invoice #\tCustomer\n1\tx"), "\t");
assert.equal(detectDelimiter("Customer;Email;Phone\n"), ";");
assert.equal(detectDelimiter('Customer,"Address, line",Phone'), ",");
assert.deepEqual(splitRecords('a,"b, c","say ""hi""",d\n1,2,3,4', ","), [{ line: 1, cells: ["a", "b, c", 'say "hi"', "d"] }, { line: 2, cells: ["1", "2", "3", "4"] }]);
assert.deepEqual(splitRecords('x,"multi\nline",y\nz', ",").map((r) => [r.line, r.cells.length]), [[1, 3], [3, 1]], "a quoted cell may span lines");
assert.deepEqual(splitRecords("a\t b\t\n", "\t")[0].cells, ["a", " b", ""], "tabs keep spaces (cleaned later)");

/* headers, amounts, dates */
assert.equal(headerKey("Invoice #"), "invoice no"); assert.equal(headerKey("No."), "no"); assert.equal(headerKey("E-mail"), "e mail"); assert.equal(headerKey("Amount Paid"), "amount paid");
assert.equal(parseImportAmount("$1,250.50"), 125050); assert.equal(parseImportAmount("625.1"), 62510); assert.equal(parseImportAmount(""), null); assert.equal(parseImportAmount("-"), null);
assert.equal(parseImportAmount("(50.00)"), -5000); assert.equal(parseImportAmount("USD 10"), 1000); assert.ok(Number.isNaN(parseImportAmount("ten dollars")!)); assert.ok(Number.isNaN(parseImportAmount("1.234")!));
assert.equal(parseImportDate("2026-11-20"), "2026-11-20"); assert.equal(parseImportDate("11/20/2026"), "2026-11-20"); assert.equal(parseImportDate("1/5/26"), "2026-01-05");
assert.equal(parseImportDate("Nov 20, 2026"), "2026-11-20"); assert.equal(parseImportDate("November 20 2026"), "2026-11-20"); assert.equal(parseImportDate("20 Nov 2026"), "2026-11-20"); assert.equal(parseImportDate("Sept. 3, 2026"), "2026-09-03");
assert.equal(parseImportDate(""), null); assert.equal(parseImportDate("2/30/2026"), "bad"); assert.equal(parseImportDate("soon"), "bad"); assert.equal(parseImportDate("2026-11-20T10:00:00Z"), "2026-11-20");

/* invoices pasted from Skynova's table (tab separated), with junk around */
const pasted = [
  "Invoices",
  "Invoice #\tCustomer\tInvoice Date\tDue Date\tTotal\tAmount Paid\tBalance Due\tStatus",
  "0000169\tSample Bistro - Sampleton\t11/20/2026\t11/20/2026\t$625.10\t$0.00\t$625.10\tUnpaid",
  "168\tSample Bistro - Sampleton\tNov 1, 2026\tNov 1, 2026\t$550.00\t$550.00\t$0.00\tPaid",
  "167\tSAMPLE Noodle House\t10/05/2026\t10/20/2026\t\t$250.50\t$1,000.00\tPartially Paid",
  "Invoice #\tCustomer\tInvoice Date\tDue Date\tTotal\tAmount Paid\tBalance Due\tStatus",
  "\t\t\t\t\t\t\t",
  "166\tSAMPLE Gone Cafe\t10/01/2026\t10/01/2026\t$100.00\t\t\tVoid",
  "165\t\t10/01/2026\t\t$100.00\t\t\tUnpaid",
  "164\tSAMPLE Card\t10/01/2026\t\tcard 4242 4242 4242 4242\t\t\tUnpaid",
  "163\tSAMPLE Weird\t13/45/2026\t\t$80\t\t\t",
  "0000169\tSample Bistro - Sampleton\t11/20/2026\t\t$1\t\t\t",
  "162\tSAMPLE Paid Status\t09/01/2026\t\t$300\t\t\tPaid",
  "161\tSAMPLE Due Before\t09/10/2026\t09/01/2026\t$300\t\t\tUnpaid",
  "Total\t\t\t\t$2,425.60",
].join("\r\n");
const p = parseImport(pasted, "invoices");
assert.deepEqual(p.columns.slice(0, 3), ["Invoice #", "Customer", "Invoice Date"]);
assert.deepEqual(p.mapping, { number: "Invoice #", customerName: "Customer", issueDate: "Invoice Date", dueDate: "Due Date", total: "Total", paid: "Amount Paid", balance: "Balance Due", status: "Status" });
assert.deepEqual(p.skipped.map((s) => s.reason), ["Before the header row", "Repeated header row", "Totals row"]);
const by = (n: string) => p.invoices.filter((r) => r.number === n);
assert.deepEqual(by("0000169")[0], { line: 3, number: "0000169", customerName: "Sample Bistro - Sampleton", issueDate: "2026-11-20", dueDate: "2026-11-20", totalCents: 62510, paidCents: 0, description: null, existingCustomerId: null, existingInvoiceId: null, issues: [] });
assert.deepEqual([by("0000168")[0].totalCents, by("0000168")[0].paidCents, by("0000168")[0].issueDate], [55000, 55000, "2026-11-01"], "\"168\" is the same number as 0000168");
assert.deepEqual([by("0000167")[0].totalCents, by("0000167")[0].paidCents], [125050, 25050], "total = paid + balance when the total is blank");
assert.deepEqual(by("0000166")[0].issues, ["void in Skynova: not imported"]);
assert.deepEqual(by("0000165")[0].issues, ["no customer"]);
assert.ok(by("0000164")[0].issues.includes("card or bank number in the text"));
assert.ok(by("0000163")[0].issues.includes("invoice date not understood (use 11/20/2026)"));
assert.deepEqual(by("0000169")[1].issues, ["this number appears twice in the paste"]);
assert.equal(by("0000162")[0].paidCents, 30000, "status Paid with no paid column: paid in full");
assert.deepEqual(by("0000161")[0].issues, ["due date before the invoice date"]);
assert.equal(p.invoices.filter((r) => !r.issues.length).length, 4);
assert.equal(importedLine({ number: "0000169", description: null }), "Imported from Skynova (invoice 0000169)");
assert.equal(importedLine({ number: "0000169", description: "Standard Content Creation Package" }), "Standard Content Creation Package");

/* a CSV someone typed, with semicolons and "Amount" / "Balance" / "No." headers */
const typed = parseImport('No.;Client;Date;Amount;Balance\nSKY-12;"SAMPLE Taco, LLC";2026-10-01;450;0\n171;SAMPLE Tea;2026-10-02;$90.00;$90.00\n', "invoices");
assert.deepEqual(typed.invoices.map((r) => [r.number, r.customerName, r.totalCents, r.paidCents, r.issues.length]), [["SKY-12", "SAMPLE Taco, LLC", 45000, 45000, 0], ["0000171", "SAMPLE Tea", 9000, 0, 0]]);

/* customers */
const cust = parseImport("Customer Name,Contact,Email,Phone,Address,City,State,Zip,Notes\nSample Bistro - Sampleton,Sam Sample,SAM@Sample.test,(555) 010-0101,1 Example Ave Ste 102,Sampleton,VA,23000,likes Zelle\n,No Name,,,,,,,\nSAMPLE Tea,,not-an-email,,,,,,\n", "customers");
assert.deepEqual(cust.customers[0], { line: 2, name: "Sample Bistro - Sampleton", contactName: "Sam Sample", email: "sam@sample.test", phone: "(555) 010-0101", billingAddress: "1 Example Ave Ste 102\nSampleton, VA 23000", notes: "likes Zelle", existingCustomerId: null, issues: [] });
assert.deepEqual(cust.customers[1].issues, ["no customer name"]);
assert.equal(cust.customers[2].email, null, "a bad email is dropped, not saved");

/* no header, empty, too many */
assert.match(parseImport("just some text\nmore", "invoices").skipped[0].reason, /No header row/);
assert.deepEqual(parseImport("   ", "customers"), { kind: "customers", columns: [], mapping: {}, customers: [], invoices: [], skipped: [] });
const big = ["Customer", ...Array.from({ length: IMPORT_MAX_ROWS + 3 }, (_, i) => `SAMPLE ${i}`)].join("\n");
const bp = parseImport(big, "customers");
assert.equal(bp.customers.length, IMPORT_MAX_ROWS); assert.equal(bp.skipped.length, 3);

console.log("invoice-import parser: ok");
