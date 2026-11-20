/**
 * Proofs for drizzle/0017 and the numbering statements in docs/invoicing.md ("Numbers", "Atomic statements"), each on
 * a throwaway PGlite: a fresh migrate + seed (first number 0000170), upgrades from 0016 with data, and the finalize
 * UPDATE / create-and-finalize INSERT / import bump / "Next invoice number" statements. Run from the repo root:
 *   npx tsx scripts/test-invoice-numbers.mts
 * Written by the design step; core keeps these statements in lib/ops-invoices and may fold this into its ops tests.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import * as schema from "../src/lib/schema";
import { seed } from "../src/lib/seed";

const NUM = (v: string) => `lpad(${v}::text, greatest(7, length(${v}::text)), '0')`;
// The number a finalize takes: the next free one (a number already on an invoice is skipped, burning it).
const TAKE = `(select n from (select ${NUM("v")} as n from (select nextval('invoice_number_seq') as v from generate_series(1, 1000)) q) s
               where not exists (select 1 from invoices x where x.number = s.n) limit 1)`;
const SEND = (id: string, today: string) => `
update invoices set
  issue_date = coalesce(issue_date, '${today}'),
  due_date   = coalesce(due_date, to_char(coalesce(issue_date, '${today}')::date + terms_days, 'YYYY-MM-DD')),
  number     = coalesce(number, ${TAKE}),
  status     = case when status = 'draft' then 'sent' else status end,
  sent_at    = coalesce(sent_at, now()), sent_by = coalesce(sent_by, 'nora@local'), updated_at = now()
where id = '${id}' and status <> 'void' and total_cents > 0
returning id, number, issue_date, due_date, status, pay_ways`;
const NEXT = `select case when is_called then last_value + 1 else last_value end as next from invoice_number_seq`;
const MAX_USED = `(select coalesce(max(number::bigint), 0) + 1 from invoices where number ~ '^[0-9]{1,18}$')`;
const BUMP = `select setval('invoice_number_seq', greatest((${NEXT}), ${MAX_USED}), false) as v`;
const SET_NEXT = (n: number) => `select setval('invoice_number_seq', greatest(${n}::bigint, ${MAX_USED}), false) as v`;
const PEEK = `select ${NUM("min(g)")} as n from generate_series((${NEXT}), (${NEXT}) + 1000) g
              where not exists (select 1 from invoices x where x.number = ${NUM("g")})`;

async function q<T = any>(c: PGlite, s: string): Promise<T[]> { return (await c.query<T>(s)).rows; }
const next = async (c: PGlite) => Number((await q<{ next: string }>(c, NEXT))[0].next);

async function fresh() {
  const dir = mkdtempSync(join(tmpdir(), "nhq-0017-fresh-"));
  const c = new PGlite(dir);
  const db = drizzle(c, { schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  await seed(db as any);
  await migrate(db, { migrationsFolder: "./drizzle" }); // re-run: no-op
  assert.equal(await next(c), 170, "fresh: first number is 170");
  assert.equal((await q(c, PEEK))[0].n, "0000170");
  // columns and defaults
  await c.exec(`insert into customers (id, name, name_key, created_by) values ('c1', 'Sample Bistro', 'sample bistro', 't')`);
  await c.exec(`insert into contracts (id, kind, client_business, fields, created_by, customer_id) values ('k1', 'collab', 'Sample Bistro', '{}', 't', 'c1')`);
  await c.exec(`insert into invoices (id, customer_id, items, subtotal_cents, total_cents, created_by, contract_id) values
    ('d1', 'c1', '[{"description":"Standard Content Creation Package","quantity":1,"unitCents":55000}]', 55000, 55000, 't', 'k1'),
    ('d2', 'c1', '[]', 7510, 7510, 't', null), ('d3', 'c1', '[]', 1000, 1000, 't', null), ('d0', 'c1', '[]', 0, 0, 't', null)`);
  const [d1] = await q(c, `select terms_days, pay_ways, pay_note, contract_id from invoices where id = 'd1'`);
  assert.deepEqual(d1, { terms_days: 0, pay_ways: ["zelle"], pay_note: null, contract_id: "k1" });
  // Make PDF on a draft: 0000170, due on receipt (same day); a second press changes nothing and burns nothing
  const [s1] = await q(c, SEND("d1", "2026-11-20"));
  assert.deepEqual([s1.number, s1.issue_date, s1.due_date, s1.status], ["0000170", "2026-11-20", "2026-11-20", "sent"]);
  const [again] = await q(c, SEND("d1", "2026-11-21"));
  assert.deepEqual([again.number, again.issue_date], ["0000170", "2026-11-20"]);
  assert.equal(await next(c), 171, "re-send burns nothing");
  assert.equal((await q(c, SEND("d0", "2026-11-20"))).length, 0, "a $0 invoice is refused");
  assert.equal(await next(c), 171, "refused send burns nothing");
  // 0000171 next; then an import lands 0000172 WITHOUT moving the sequence (a race): the next finalize skips it
  assert.equal((await q(c, SEND("d2", "2026-11-20")))[0].number, "0000171");
  await c.exec(`insert into invoices (id, number, customer_id, status, issue_date, due_date, total_cents, source, created_by) values ('imp172', '0000172', 'c1', 'sent', '2026-11-01', '2026-11-01', 100, 'import', 't')`);
  assert.equal((await q(c, PEEK))[0].n, "0000173", "peek skips a used number");
  assert.equal((await q(c, SEND("d3", "2026-11-20")))[0].number, "0000173", "finalize skips the imported 0000172");
  // Create-and-finalize in ONE insert (the fast creator): takes the next free number
  const [ins] = await q(c, `insert into invoices (id, number, customer_id, status, issue_date, due_date, total_cents, pay_ways, created_by, sent_at, sent_by)
    values ('f1', ${TAKE}, 'c1', 'sent', '2026-11-20', '2026-11-20', 62510, '["zelle","check"]', 'nora@local', now(), 'nora@local') returning number, pay_ways`);
  assert.deepEqual(ins, { number: "0000174", pay_ways: ["zelle", "check"] });
  // An import of 0000190 moves the sequence past it (BUMP); never backwards
  await c.exec(`insert into invoices (id, number, customer_id, status, total_cents, source, created_by) values ('imp190', '0000190', 'c1', 'sent', 100, 'import', 't')`);
  await q(c, BUMP);
  assert.equal(await next(c), 191);
  await q(c, BUMP);
  assert.equal(await next(c), 191, "bump is idempotent");
  // A person sets the next number: honoured upwards, floored past every used number
  await q(c, SET_NEXT(500)); assert.equal(await next(c), 500);
  await q(c, SET_NEXT(100)); assert.equal(await next(c), 191, "can't go back onto used numbers");
  await q(c, SET_NEXT(9999999));
  await c.exec(`insert into invoices (id, customer_id, total_cents, created_by) values ('big1', 'c1', 100, 't'), ('big2', 'c1', 100, 't')`);
  assert.equal((await q(c, SEND("big1", "2026-11-20")))[0].number, "9999999");
  assert.equal((await q(c, SEND("big2", "2026-11-20")))[0].number, "10000000", "8 digits are not truncated");
  // contract delete: invoices and contract links set null
  await c.exec(`delete from contracts where id = 'k1'`);
  assert.equal((await q(c, `select contract_id from invoices where id = 'd1'`))[0].contract_id, null);
  // customer delete: a contract's customer link is set null (customers with invoices are restrict)
  await c.exec(`insert into customers (id, name, name_key, created_by) values ('c2', 'X', 'x', 't'); insert into contracts (id, kind, client_business, fields, created_by, customer_id) values ('k2', 'monthly', 'X', '{}', 't', 'c2'); insert into retainers (id, customer_id, description, amount_cents, created_by, contract_id) values ('r2', 'c2', 'Monthly', 80000, 't', 'k2')`);
  await assert.rejects(c.exec(`insert into retainers (id, customer_id, description, amount_cents, created_by, contract_id) values ('r3', 'c2', 'Again', 80000, 't', 'k2')`), /retainers_contract_uq/, "one retainer per contract");
  await c.exec(`insert into retainers (id, customer_id, description, amount_cents, created_by) values ('r4', 'c2', 'No contract', 1, 't'), ('r5', 'c2', 'No contract', 1, 't')`);
  await c.exec(`delete from contracts where id = 'k2'`);
  assert.equal((await q(c, `select contract_id from retainers where id = 'r2'`))[0].contract_id, null);
  await c.exec(`delete from customers where id = 'c2'`);
  await c.close(); rmSync(dir, { recursive: true, force: true });
  console.log("fresh migrate + seed: ok (first number 0000170, 0000171, skips imported 0000172, insert-finalize, bump, set next, 8 digits)");
}

async function upgrade(imported: string | null, expectNext: number) {
  // A migrations folder that stops at 0016, as a preview build may have applied it.
  const mig = mkdtempSync(join(tmpdir(), "nhq-mig16-"));
  cpSync("./drizzle", mig, { recursive: true });
  rmSync(join(mig, "0017_invoicing_fast_creator.sql"));
  const j = JSON.parse(readFileSync(join(mig, "meta/_journal.json"), "utf8"));
  j.entries = j.entries.filter((e: { idx: number }) => e.idx <= 16);
  writeFileSync(join(mig, "meta/_journal.json"), JSON.stringify(j));
  const dir = mkdtempSync(join(tmpdir(), "nhq-0017-up-"));
  const c = new PGlite(dir);
  const db = drizzle(c, { schema });
  await migrate(db, { migrationsFolder: mig });
  await seed(db as any);
  // 0016-era data: old INV numbers from the old send (sequence used 3 times), a draft, a contract, maybe an import
  await c.exec(`insert into customers (id, name, name_key, created_by) values ('c1', 'Sample Bistro', 'sample bistro', 't')`);
  await c.exec(`insert into contracts (id, kind, client_business, fields, created_by) values ('k1', 'collab', 'Sample Bistro', '{}', 't')`);
  for (const i of [1, 2, 3]) await c.exec(`insert into invoices (id, number, customer_id, status, issue_date, due_date, total_cents, created_by) values ('old${i}', 'INV-2026-' || lpad(nextval('invoice_number_seq')::text, 4, '0'), 'c1', 'sent', '2026-11-01', '2026-11-15', 1000, 't')`);
  await c.exec(`insert into invoices (id, customer_id, total_cents, created_by) values ('draft1', 'c1', 5000, 't')`);
  if (imported) await c.exec(`insert into invoices (id, number, customer_id, status, total_cents, source, created_by) values ('imp', '${imported}', 'c1', 'sent', 100, 'import', 't')`);
  // now the real folder: only 0017 runs
  await migrate(db, { migrationsFolder: "./drizzle" });
  await migrate(db, { migrationsFolder: "./drizzle" });
  const applied = await q<{ n: number }>(c, `select count(*)::int as n from drizzle.__drizzle_migrations`);
  assert.equal(applied[0].n, 18, "0000..0017 applied once each");
  assert.equal(await next(c), expectNext, `upgrade (${imported ?? "no import"}): next is ${expectNext}`);
  const rows = await q(c, `select id, number, terms_days, pay_ways, contract_id from invoices order by id`);
  for (const r of rows) assert.deepEqual(r.pay_ways, ["zelle"], "existing rows default to Zelle");
  assert.equal(rows.find((r) => r.id === "old1").number, "INV-2026-0001", "old numbers stay as they were");
  assert.equal(rows.find((r) => r.id === "draft1").terms_days, 14, "an existing draft keeps its terms");
  await c.exec(`insert into invoices (id, customer_id, total_cents, created_by) values ('new1', 'c1', 100, 't')`);
  assert.equal((await q(c, `select terms_days from invoices where id = 'new1'`))[0].terms_days, 0, "new rows are due on receipt");
  const [s] = await q(c, SEND("draft1", "2026-11-20"));
  assert.equal(s.number, String(expectNext).padStart(7, "0"));
  await c.exec(`update invoices set contract_id = 'k1' where id = 'draft1'; update contracts set customer_id = 'c1' where id = 'k1'; update customers set stripe_customer_id = 'cus_sample' where id = 'c1'`);
  await c.close();
  rmSync(dir, { recursive: true, force: true }); rmSync(mig, { recursive: true, force: true });
  console.log(`upgrade from 0016 with data (${imported ?? "no import"}): ok, next ${String(expectNext).padStart(7, "0")}`);
}

await fresh();
await upgrade(null, 170);
await upgrade("0000169", 170);
await upgrade("0000180", 181);
console.log("all 0017 proofs passed");
