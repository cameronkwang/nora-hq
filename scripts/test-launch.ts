/**
 * Checks for src/lib/launch.ts (pre-launch rule) and src/lib/profile-copy.ts (profile text limits) — no test
 * framework, just: npx tsx scripts/test-launch.ts
 * Exits non-zero on the first wrong answer.
 */
import assert from "node:assert/strict";
import { daysBetween, isDay, launchInfo, openingLine, planHoldLine } from "../src/lib/launch";
import { PROFILE_COPY_LABEL, checkProfileCopy, overLimitLine, profileCopySurface } from "../src/lib/profile-copy";
import { PROFILE_COPY_LIMITS } from "../src/lib/schema";

/* ── days ── */
assert.equal(isDay("2026-12-12"), true);
assert.equal(isDay("2026-02-30"), false);
assert.equal(isDay("12/12/2026"), false);
assert.equal(isDay(null), false);
assert.equal(daysBetween("2026-11-14", "2026-12-12"), 28);
assert.equal(daysBetween("2026-12-12", "2026-11-14"), -28);
assert.equal(daysBetween("2026-03-07", "2026-03-09"), 2); // across the DST change

/* ── an open business: nothing is on hold ── */
{
  const i = launchInfo({ prelaunch: false, openingDate: "2026-12-12" }, "2026-11-14");
  assert.deepEqual(i, { prelaunch: false, openingDate: null, daysToOpening: null, planOnHold: false, opened: false });
  assert.equal(openingLine(i), "");
  assert.equal(planHoldLine("Free Market Depot", i), "");
}

/* ── pre-launch, opening day ahead: the plan waits ── */
{
  const i = launchInfo({ prelaunch: true, openingDate: "2026-12-12" }, "2026-11-14");
  assert.equal(i.daysToOpening, 28);
  assert.equal(i.planOnHold, true);
  assert.equal(i.opened, false);
  assert.equal(openingLine(i), "Opens Dec 12 · in 28 days");
  assert.match(planHoldLine("Free Market Depot", i), /isn't open yet \(opens Dec 12\)/);
  assert.equal(openingLine(launchInfo({ prelaunch: true, openingDate: "2026-11-15" }, "2026-11-14")), "Opens tomorrow (Nov 15)");
}

/* ── pre-launch, no date yet: the plan waits until someone adds one ── */
{
  const i = launchInfo({ prelaunch: true, openingDate: null }, "2026-11-14");
  assert.equal(i.planOnHold, true);
  assert.equal(i.daysToOpening, null);
  assert.equal(openingLine(i), "No opening date yet");
  assert.match(planHoldLine("Free Market Depot", i), /no opening date/);
  // A date that isn't a date counts as none.
  assert.equal(launchInfo({ prelaunch: true, openingDate: "soon" }, "2026-11-14").openingDate, null);
}

/* ── opening day and after: the normal plan applies, even with the switch still on ── */
{
  const today = launchInfo({ prelaunch: true, openingDate: "2026-11-14" }, "2026-11-14");
  assert.equal(today.planOnHold, false);
  assert.equal(today.opened, true);
  assert.equal(openingLine(today), "Opening day is today");
  const past = launchInfo({ prelaunch: true, openingDate: "2026-11-01" }, "2026-11-14");
  assert.equal(past.planOnHold, false);
  assert.equal(past.daysToOpening, -13);
  assert.equal(openingLine(past), "Opening day was Nov 1");
}

/* ── profile text: surfaces and limits ── */
assert.deepEqual(PROFILE_COPY_LIMITS, { instagram_bio: 150, tiktok_bio: 80, google_description: 750 });
assert.equal(profileCopySurface({ surface: "tiktok_bio" }), "tiktok_bio");
assert.equal(profileCopySurface({ surface: "facebook_bio" }), null);
assert.equal(profileCopySurface({}), null);
assert.equal(profileCopySurface(null), null);

{
  const ok = checkProfileCopy("instagram_bio", "  Colonial Heights' new bargain store. Opening Dec 12.  ");
  assert.equal(ok.over, 0);
  assert.equal(ok.length, 52); // trimmed
  assert.equal(ok.max, 150);
  assert.deepEqual(ok.warnings, []);

  const long = checkProfileCopy("tiktok_bio", "x".repeat(81));
  assert.equal(long.over, 1);
  assert.equal(overLimitLine(long), `${PROFILE_COPY_LABEL.tiktok_bio} is 81 characters; the limit is 80. Cut 1.`);
  assert.equal(checkProfileCopy("tiktok_bio", "x".repeat(80)).over, 0);
  assert.equal(checkProfileCopy("google_description", "x".repeat(750)).over, 0);
  assert.equal(checkProfileCopy("google_description", "x".repeat(751)).over, 1);
  // An emoji counts as 2, the way the platforms count.
  assert.equal(checkProfileCopy("instagram_bio", "🦀").length, 2);
}

/* ── profile text: soft checks ── */
assert.equal(checkProfileCopy("google_description", "A family-run seafood boil. Order at craboclock.com").warnings.length, 1);
assert.equal(checkProfileCopy("google_description", "All you can eat for $29.99 every day.").warnings.length, 1);
assert.deepEqual(checkProfileCopy("google_description", "A discount store with new deals every week.").warnings, []);
assert.equal(checkProfileCopy("tiktok_bio", "Deals daily. www.example.com").warnings.length, 1);
assert.deepEqual(checkProfileCopy("instagram_bio", "Seafood boil · Fredericksburg\nOpen daily 11–10").warnings, []);

console.log("launch + profile-copy: all checks passed");
