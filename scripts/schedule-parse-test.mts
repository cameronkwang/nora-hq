/**
 * Checks the schedule paste parser against a list written the way Nora keeps hers. Every business name and amount
 * here is invented: this file must never hold her real list (it has what each business pays). Run: npx tsx scripts/schedule-parse-test.mts
 */
import assert from "node:assert/strict";
import { inferYear, looksLikeMoney, matchBusiness, parseSchedule, scheduleNameKey } from "../src/lib/schedule-parse.ts";

const SAMPLE = `December
1. 12/01 | Golden Wok - $900.00 ()
2. 12/01 | Golden Wok West - $700.00 ()
3. 12/XX | Lotus Spa - $300.00 ()

November
1. 11/01 | Golden Wok - $900.00 () 🚩 $450.00
2. 11/01 | Golden Wok Reel Boost - $80.00 🚩 $35
3. 11/01 | Golden Wok West - $700.00 () 🚩
4. 11/01 | Tide Poke - $450.00 () 🚩
5. 11/01 | Lotus Spa - $300.00 (Check)
6. 11/01 | Noodle O’Clock - $375.00 (Zelle)
7. 11/01 | Pan Pan Midtown - $475.00 (Check) 📸
8. 11/01 | Quick Cart - $250.00 (Zelle)
9. 11/04 | Marcello’s - FREE 📸
10. 11/07 | Salt & Smoke - $475.00 (Check)
11. 11/11 | Pan Pan (DC) - $525.00 () 📸 🚩
12. 11/11 | Olive Tree - FREE 📸
13. 11/12 | Kumo - $525.00 () 📸 🚩
14. 11/12 | Puff Cloud - $325.00 () 📸 🚩
15. 11/12 | Saigon Lane - $275.00 () 📸 🚩
16. 11/13 | Sip Club - FREE 📸
17. 11/13| Golden Wok (Midtown) - FREE 📸
18. 11/14 | Champions - $650.00 () 📸 🚩
19. 11/14 | Maki Go - $475.00 () 📸 🚩
20. 11/XX | Cocoa House - $200.00 () 📸
21. 11/18 | Pixel Arcade - $425.00 () 📸
22. 11/18 | Comet Burger - FREE
23. 11/18 | Corner Bakery Co - $425.00 ()
24. 11/19 | Sixth Sense - $425.00 ()
25. 11/25 | Red Finch - $3000.00 ()
26. 11/29 | ZAO - $525.00 ()
27. 11/29 | Fryin’ Tails - $525.00 ()
28. 11/30 | Harbor Kitchen - $425.00 (Zelle) 📸
29. 11/30 | Spice Palace - FREE
30. 11/30 | Saffron - FREE
31. 11/XX | Petal - FREE
32. 11/XX | Lantern Fest - FREE
33. 11/XX | Tony’s Pizza - $275.00 ()
34. 11/XX | Sushi Garden - $325.00 ()
35. 11/XX | Ember - $375.00 ()
36. 11/XX | Wrap Spot - $425.00 ()
37. 11/XX | Tasty Kabob - $325.00 ()
38. 10/XX | Burrito Bros - $600.00 ()
39. 10/XX | Noodle Zip - $425.00 ()
40. 09/XX | K-Market - $425.00 ()
41. 09/XX | Smash Stop - $550.00 ()
42. 09/XX | The Fountain - $475.00 ()
43. 08/XX | Sam’s Smokehouse - $425.00 ()
44. 08/XX | Bangkok Bites - $425.00 ()
45. 08/XX | River Co - $525.00 ()
46. 07/XX | Thai Basil - $425.00 ()
47. 05/XX | Sagar - $375.00 ()
48. 05/XX | Palm & Shore Bistro - FREE
49. 04/XX | Thai Home - $475.00 ()
50. 04/XX | Uptown Grill - $425.00 ()
`;

const out = parseSchedule(SAMPLE, { today: "2026-11-13" });
const all = out.months.flatMap((m) => m.items.map((i) => ({ ...i, month: m.month })));
const count = (month: string) => out.months.find((m) => m.month === month)?.items.length ?? 0;
const find = (month: string, name: string) => all.find((i) => i.month === month && i.businessName === name);

assert.deepEqual(out.skipped, [], `nothing skipped, got ${JSON.stringify(out.skipped)}`);
// 3 (Dec) + 50 (the numbered Nov…Apr list) = 53.
assert.equal(all.length, 53, "53 items");
assert.deepEqual(
  Object.fromEntries(out.months.map((m) => [m.month, m.items.length])),
  { "2026-12": 3, "2026-11": 37, "2026-10": 2, "2026-09": 3, "2026-08": 3, "2026-07": 1, "2026-05": 2, "2026-04": 2 },
);
assert.equal(count("2026-11"), 37);

const anto = find("2026-11", "Marcello’s");
assert.ok(anto, "Marcello’s keeps its curly quote for display");
assert.equal(anto.isFree, true);
assert.equal(anto.needsReel, true);
assert.equal(anto.date, "2026-11-04");
assert.equal(anto.nameKey, "marcellos");

const midlo = find("2026-11", "Golden Wok (Midtown)");
assert.ok(midlo, "11/13| without a space parses");
assert.equal(midlo.date, "2026-11-13");
assert.equal(midlo.isFree, true);
assert.equal(midlo.needsReel, true);

const mkDec = find("2026-12", "Lotus Spa");
assert.ok(mkDec);
assert.equal(mkDec.date, null, "12/XX → no set day");

assert.equal(find("2026-11", "Golden Wok Reel Boost")?.date, "2026-11-01");
assert.equal(find("2026-11", "Pan Pan (DC)")?.needsReel, true, "📸 before 🚩 still counts");
assert.equal(find("2026-11", "Pan Pan (DC)")?.isFree, false);
assert.equal(find("2026-11", "Salt & Smoke")?.nameKey, "salt and smoke");
assert.equal(find("2026-11", "Noodle O’Clock")?.nameKey, "noodle oclock");
assert.equal(find("2026-11", "Comet Burger")?.isFree, true);
assert.equal(find("2026-11", "Comet Burger")?.needsReel, false);
assert.equal(find("2026-11", "Red Finch")?.isFree, false);
assert.equal(all.filter((i) => i.needsReel).length, 14);
assert.equal(all.filter((i) => i.isFree).length, 10);

const json = JSON.stringify(out);
assert.ok(!/\$/.test(json), "no $ in output");
assert.ok(!/\d+\.\d\d/.test(json), "no amounts in output");
assert.ok(!/check|zelle|🚩/i.test(json), "no payment method or flag in output");
assert.ok(!/\(\)/.test(json), "no empty () in output");

// Headers with years, other spellings, skipped lines don't echo money, year rollover.
const b = parseSchedule("Nov 2025:\n11/02 Petal - FREE\nwhat is this $400.00\n02/31 | Nope - $5\n12/xx | Later\n1) 1/05 | January Place - $50 📸", { today: "2027-01-10" });
assert.equal(b.months.find((m) => m.month === "2025-11")?.items[0]?.businessName, "Petal");
assert.equal(b.months.find((m) => m.month === "2026-12")?.items[0]?.date, null, "December read in January is last year");
assert.equal(b.months.find((m) => m.month === "2027-01")?.items[0]?.needsReel, true);
assert.equal(b.skipped.length, 2);
assert.ok(!/\$|400|\b5\b/.test(JSON.stringify(b.skipped)), `skipped lines are scrubbed: ${JSON.stringify(b.skipped)}`);

// Duplicates within one paste merge.
const dup = parseSchedule("11/XX | Petal - FREE\n11/05 | Petal 📸", { today: "2026-11-13" });
assert.equal(dup.months[0].items.length, 1);
assert.equal(dup.months[0].items[0].date, "2026-11-05");
assert.equal(dup.months[0].items[0].needsReel, true);

// Amounts without "$" and payment words never end up in a business name.
const bare = parseSchedule(
  "11/04 | Petal 600.00 (Zelle)\n11/05 | Marcello’s - 450 (Check)\n11/07 | Saigon Lane – 350.00 Zelle 📸\n11/06 | Tide Poke - paid $500\n" +
    "11/08 | Route 66\n11/09 | Johnny Cash\n11/10 | Sushi 500 zelle\n11/11 | Taco Bar paid",
  { today: "2026-11-13" },
);
assert.deepEqual(bare.skipped, []);
assert.deepEqual(
  bare.months[0].items.map((i) => i.businessName),
  ["Petal", "Marcello’s", "Saigon Lane", "Tide Poke", "Route 66", "Johnny Cash", "Sushi", "Taco Bar"],
);
assert.equal(bare.months[0].items[2].needsReel, true);
assert.ok(!/\d+\.\d\d|450|500|\$/.test(JSON.stringify(bare)), `no amounts: ${JSON.stringify(bare)}`);
assert.ok(looksLikeMoney("Petal 600.00") && looksLikeMoney("Marcello’s - 450 (Check)") && looksLikeMoney("paid $500") && looksLikeMoney("Sushi 500 zelle"));
assert.ok(!looksLikeMoney("Route 66") && !looksLikeMoney("Johnny Cash") && !looksLikeMoney("Golden Wok (Midtown)"));

// Year inference: up to 3 months ahead is upcoming (rolls into next year), otherwise now or past.
const decJan = parseSchedule("January\n1. 01/05 | Petal - FREE\n2. 01/XX | Olive Tree", { today: "2026-12-15" });
assert.equal(decJan.months[0].month, "2027-01", "January pasted in December is next year");
assert.equal(decJan.months[0].items[0].date, "2027-01-05");
assert.equal(parseSchedule("02/03 | Petal", { today: "2026-11-13" }).months[0].items[0].date, "2027-02-03", "February pasted in November is next year");
assert.equal(inferYear(4, { today: "2026-11-13" }), 2026, "April read in November is this April");
assert.equal(inferYear(3, { today: "2026-11-13" }), 2026);
assert.equal(inferYear(12, { today: "2027-02-10" }), 2026, "December read in February is last year");
assert.equal(inferYear(5, { today: "2027-02-10" }), 2027, "May read in February is upcoming");
assert.equal(inferYear(11, { today: "2026-11-13" }), 2026);

// Business matching.
const clients = [
  { id: "c1", name: "Noodle O Clock", location: null },
  { id: "c2", name: "ABC Lotus Spa", location: "Sampleton" },
  { id: "c3", name: "Corner Market Depot", location: null },
];
assert.equal(matchBusiness("Noodle O’Clock", clients)?.id, "c1");
assert.equal(matchBusiness("Lotus Spa", clients)?.id, "c2");
assert.equal(matchBusiness("ABC Lotus Spa (Sampleton)", [{ id: "c2", name: "ABC Lotus Spa (Sampleton)", location: null }])?.id, "c2");
assert.equal(matchBusiness("Lotus Garden", clients), null);
assert.equal(matchBusiness("ZAO", clients), null);
assert.equal(scheduleNameKey("  Fryin’  Tails "), "fryin tails");

console.log(`schedule-parse: ok (${all.length} items, ${out.months.length} months)`);
