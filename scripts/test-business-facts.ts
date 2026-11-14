/**
 * Checks for src/lib/business-facts.ts (the Facebook Page and its old notes line) and for the wording of Claude's
 * rules that the code has to match (src/lib/mcp/rules.ts) — no test framework, just:
 *   npx tsx scripts/test-business-facts.ts
 * Exits non-zero on the first wrong answer.
 */
import assert from "node:assert/strict";
import { businessFacts, dropFacebookNote, factsChecklist, forgetFactProvenance, ownerCardFacts, readPublicInfo } from "../src/lib/business-facts";
import { SERVER_INSTRUCTIONS, WORKING_RULES } from "../src/lib/mcp/rules";

const NOTES = "Owner prefers texts.\n\nFacebook Page: facebook.com/oldpage";
const row = (notes: string | null, publicInfo: unknown) => ({ website: null, instagramHandle: null, tiktokHandle: null, notes, publicInfo });

/* ── the notes line is a fallback only while the Page was never saved or cleared as a fact ── */
assert.equal(businessFacts(row(NOTES, null)).facebook, "facebook.com/oldpage");
assert.equal(businessFacts(row(NOTES, { address: "1 Main St" })).facebook, "facebook.com/oldpage"); // other facts saved: still the fallback
assert.equal(businessFacts(row(NOTES, { facebook: "facebook.com/newpage" })).facebook, "facebook.com/newpage"); // the saved fact wins

/* ── once it was saved or cleared (facebookDecided), a line written back into the notes can't bring it back ── */
{
  const cleared = row(NOTES, { facebookDecided: true, checkedAt: "2026-11-14T15:00:00.000Z", checkedBy: "nora@local" });
  assert.equal(businessFacts(cleared).facebook, null);
  assert.equal(ownerCardFacts(cleared).some((f) => f.key === "facebook"), false); // not on the owner's "Is this right?" card
  assert.equal(factsChecklist(cleared).missing.some((m) => m.key === "facebook"), true); // counted as missing again, not as known
  assert.equal(businessFacts(row(NOTES, { facebookDecided: true, facebook: "facebook.com/newpage" })).facebook, "facebook.com/newpage");
}

/* ── the mark survives every read and rewrite of public_info, and only a real `true` counts ── */
assert.equal(readPublicInfo({ facebookDecided: true }).facebookDecided, true);
assert.equal("facebookDecided" in readPublicInfo({ facebookDecided: "yes" }), false);
assert.equal("facebookDecided" in readPublicInfo({ address: "1 Main St" }), false);
assert.equal(forgetFactProvenance({ facebookDecided: true, sources: { website: "https://example.com" } }, ["website"])?.facebookDecided, true);

/* ── a person's save takes the line out of the notes (Claude's never does: see setBusinessFacts) ── */
assert.equal(dropFacebookNote(NOTES), "Owner prefers texts.");
assert.equal(dropFacebookNote("Owner prefers texts."), "Owner prefers texts.");
assert.equal(dropFacebookNote("Facebook Page: facebook.com/oldpage"), null);

/* ── Claude's rules say what the code does ── */
const rule = (start: string) => {
  const r = WORKING_RULES.find((x) => x.startsWith(start));
  assert.ok(r, `no rule starting "${start}"`);
  return r;
};
{
  // Nora's schedule: no amount or payment method; Paid / Not paid is a badge in the app only.
  const schedule = rule("Nora's schedule");
  assert.match(schedule, /No amount or payment method \(Check\/Zelle\) ever appears on the schedule/);
  assert.match(schedule, /shows Paid or Not paid in the app only/);
  assert.match(schedule, /never include an amount or the paid status/);
  assert.doesNotMatch(SERVER_INSTRUCTIONS, /Never include money/); // the old wording forbade paid/unpaid everywhere
  // Outreach sender and offer: Claude fills them in, a person changes them (updateBusinessDetails).
  assert.match(rule("Business setup"), /fill-only for you/);
  // Public facts: Claude replaces only its own research and never edits notes (setBusinessFacts).
  const facts = rule("Public facts");
  assert.match(facts, /replace only your own earlier research/);
  assert.match(facts, /never changes the business's notes/);
}

console.log("business-facts + rules wording: all checks passed");
