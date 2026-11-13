/**
 * Checks the schedule paste parser against Nora's real list. Run: npx tsx scripts/schedule-parse-test.mts
 */
import assert from "node:assert/strict";
import { matchBusiness, parseSchedule, scheduleNameKey } from "../src/lib/schedule-parse.ts";

const SAMPLE = `December
1. 12/01 | Yummy Red Bowl - $1000.00 ()
2. 12/01 | Yummy Bowl SC - $800.00 ()
3. 12/XX | Massage Kingdom - $400.00 ()

November
1. 11/01 | Yummy Red Bowl - $1000.00 () 🚩 $500.00
2. 11/01 | Yummy Red Bowl Reel Boost - $100.00 🚩 $45
3. 11/01 | Yummy Bowl SC - $800.00 () 🚩
4. 11/01 | Poke Bros - $500.00 () 🚩
5. 11/01 | Massage Kingdom - $400.00 (Check)
6. 11/01 | Crab O’Clock - $450.00 (Zelle)
7. 11/01 | TLJ Midlothian - $550.00 (Check) 📸
8. 11/01 | Just by Quicklly - $300.00 (Zelle)
9. 11/04 | Antonelli’s - FREE 📸
10. 11/07 | Nash & Smashed - $550.00 (Check)
11. 11/11 | TLJ (DC) - $600.00 () 📸 🚩
12. 11/11 | Ayat - FREE 📸
13. 11/12 | Issho - $600.00 () 📸 🚩
14. 11/12 | Cloudette Choux - $400.00 () 📸 🚩
15. 11/12 | Doi Moi - $350.00 () 📸 🚩
16. 11/13 | Sippa - FREE 📸
17. 11/13| Yummy Red Bowl (Midlo) - FREE 📸
18. 11/14 | Legends - $750.00 () 📸 🚩
19. 11/14 | Roll Play - $550.00 () 📸 🚩
20. 11/XX | Charles Chocolates - $250.00 () 📸
21. 11/18 | Cyber Galaxy - $500.00 () 📸
22. 11/18 | Cobra Burger - FREE
23. 11/18 | Sicilian Bakery - $500.00 ()
24. 11/19 | Sesto Senso - $500.00 ()
25. 11/25 | Blackbird - $4250.00 ()
26. 11/29 | NUE - $600.00 ()
27. 11/29 | Chasin’ Tails - $600.00 ()
28. 11/30 | Pike Kitchen - $500.00 (Zelle) 📸
29. 11/30 | Punjab Palace - FREE
30. 11/30 | Ssaanjh - FREE
31. 11/XX | Bloom - FREE
32. 11/XX | Lan Fest - FREE
33. 11/XX | Marco’s Pizza - $350.00 ()
34. 11/XX | Sushi Kingdom - $400.00 ()
35. 11/XX | Ebisu - $450.00 ()
36. 11/XX | Shawarma Spot - $500.00 ()
37. 11/XX | Yummy Kabob - $400.00 ()
38. 10/XX | Fredibertos - $700.00 ()
39. 10/XX | Ramyun Zip - $500.00 ()
40. 09/XX | E-Mart - $500.00 ()
41. 09/XX | Smash Wala - $650.00 ()
42. 09/XX | The Fuente - $550.00 ()
43. 08/XX | Scott’s Smokehouse - $500.00 ()
44. 08/XX | Bangkok Boy - $500.00 ()
45. 08/XX | Tobacco Co - $600.00 ()
46. 07/XX | Sense of Thai - $500.00 ()
47. 05/XX | Saahil - $450.00 ()
48. 05/XX | Palm & Beach Bistro - FREE
49. 04/XX | My Home Thai - $550.00 ()
50. 04/XX | Downtown Grill - $500.00 ()
`;

const out = parseSchedule(SAMPLE, { today: "2026-11-13" });
const all = out.months.flatMap((m) => m.items.map((i) => ({ ...i, month: m.month })));
const count = (month: string) => out.months.find((m) => m.month === month)?.items.length ?? 0;
const find = (month: string, name: string) => all.find((i) => i.month === month && i.businessName === name);

assert.deepEqual(out.skipped, [], `nothing skipped, got ${JSON.stringify(out.skipped)}`);
// The brief said "50"; counted exactly it is 3 (Dec) + 50 (the numbered Nov…Apr list) = 53.
assert.equal(all.length, 53, "53 items");
assert.deepEqual(
  Object.fromEntries(out.months.map((m) => [m.month, m.items.length])),
  { "2026-12": 3, "2026-11": 37, "2026-10": 2, "2026-09": 3, "2026-08": 3, "2026-07": 1, "2026-05": 2, "2026-04": 2 },
);
assert.equal(count("2026-11"), 37);

const anto = find("2026-11", "Antonelli’s");
assert.ok(anto, "Antonelli’s keeps its curly quote for display");
assert.equal(anto.isFree, true);
assert.equal(anto.needsReel, true);
assert.equal(anto.date, "2026-11-04");
assert.equal(anto.nameKey, "antonellis");

const midlo = find("2026-11", "Yummy Red Bowl (Midlo)");
assert.ok(midlo, "11/13| without a space parses");
assert.equal(midlo.date, "2026-11-13");
assert.equal(midlo.isFree, true);
assert.equal(midlo.needsReel, true);

const mkDec = find("2026-12", "Massage Kingdom");
assert.ok(mkDec);
assert.equal(mkDec.date, null, "12/XX → no set day");

assert.equal(find("2026-11", "Yummy Red Bowl Reel Boost")?.date, "2026-11-01");
assert.equal(find("2026-11", "TLJ (DC)")?.needsReel, true, "📸 before 🚩 still counts");
assert.equal(find("2026-11", "TLJ (DC)")?.isFree, false);
assert.equal(find("2026-11", "Nash & Smashed")?.nameKey, "nash and smashed");
assert.equal(find("2026-11", "Crab O’Clock")?.nameKey, "crab oclock");
assert.equal(find("2026-11", "Cobra Burger")?.isFree, true);
assert.equal(find("2026-11", "Cobra Burger")?.needsReel, false);
assert.equal(find("2026-11", "Blackbird")?.isFree, false);
assert.equal(all.filter((i) => i.needsReel).length, 14);
assert.equal(all.filter((i) => i.isFree).length, 10);

const json = JSON.stringify(out);
assert.ok(!/\$/.test(json), "no $ in output");
assert.ok(!/\d+\.\d\d/.test(json), "no amounts in output");
assert.ok(!/check|zelle|🚩/i.test(json), "no payment method or flag in output");
assert.ok(!/\(\)/.test(json), "no empty () in output");

// Headers with years, other spellings, skipped lines don't echo money, year rollover.
const b = parseSchedule("Nov 2025:\n11/02 Bloom - FREE\nwhat is this $400.00\n02/31 | Nope - $5\n12/xx | Later\n1) 1/05 | January Place - $50 📸", { today: "2027-01-10" });
assert.equal(b.months.find((m) => m.month === "2025-11")?.items[0]?.businessName, "Bloom");
assert.equal(b.months.find((m) => m.month === "2026-12")?.items[0]?.date, null, "December read in January is last year");
assert.equal(b.months.find((m) => m.month === "2027-01")?.items[0]?.needsReel, true);
assert.equal(b.skipped.length, 2);
assert.ok(!/\$|400|\b5\b/.test(JSON.stringify(b.skipped)), `skipped lines are scrubbed: ${JSON.stringify(b.skipped)}`);

// Duplicates within one paste merge.
const dup = parseSchedule("11/XX | Bloom - FREE\n11/05 | Bloom 📸", { today: "2026-11-13" });
assert.equal(dup.months[0].items.length, 1);
assert.equal(dup.months[0].items[0].date, "2026-11-05");
assert.equal(dup.months[0].items[0].needsReel, true);

// Business matching.
const clients = [
  { id: "c1", name: "Crab O Clock", location: null },
  { id: "c2", name: "SNF Massage Kingdom", location: "Richmond" },
  { id: "c3", name: "Free Market Depot", location: null },
];
assert.equal(matchBusiness("Crab O’Clock", clients)?.id, "c1");
assert.equal(matchBusiness("Massage Kingdom", clients)?.id, "c2");
assert.equal(matchBusiness("SNF Massage Kingdom (Richmond)", [{ id: "c2", name: "SNF Massage Kingdom (Richmond)", location: null }])?.id, "c2");
assert.equal(matchBusiness("Sushi Kingdom", clients), null);
assert.equal(matchBusiness("NUE", clients), null);
assert.equal(scheduleNameKey("  Chasin’  Tails "), "chasin tails");

console.log(`schedule-parse: ok (${all.length} items, ${out.months.length} months)`);
