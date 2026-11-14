/**
 * Checks for the pure rules behind the outreach profile, the creator check, "already featured" and the
 * per-business Google review status — no test framework, just: npx tsx scripts/test-outreach-profile.ts
 *   src/lib/outreach-profile.ts  (sender + offer, stale stats, already posted, reads-as-Nora, email send plan)
 *   src/lib/google-status.ts     (ok / 0 reviews / error / not linked / not connected / never / stale)
 * Exits non-zero on the first wrong answer.
 */
import assert from "node:assert/strict";
import {
  STATS_STALE_DAYS, alreadyPosted, draftChannel, emailSendPlan, guessSendFromKind, outreachProfileOf, publicUrl, readsAsNora, sendFromText,
  senderMismatch, senderWithKind, statsCheck,
} from "../src/lib/outreach-profile";
import { GOOGLE_NEW_LISTING_DAYS, GOOGLE_SYNC_STALE_HOURS, googleSyncInfo, googleSyncSentence, isNewListing } from "../src/lib/google-status";

const now = new Date("2026-11-14T15:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

/* ── outreach profile: who it's sent from ── */
{
  const crab = outreachProfileOf({ id: "crab-o-clock", name: "Crab O Clock", sendFromKind: "instagram", sendFrom: " @craboclockfredericksburg ", creatorOffer: "Free all-you-can-eat seafood boil for 2" });
  assert.equal(crab.sendFrom, "@craboclockfredericksburg");
  assert.equal(senderWithKind(crab), "@craboclockfredericksburg (Instagram)");
  assert.equal(senderMismatch(crab, "instagram_dm"), null);
  assert.match(senderMismatch(crab, "tiktok_dm") ?? "", /This is a TikTok DM, but Crab O Clock's saved sender is @craboclockfredericksburg \(Instagram\)/);
  assert.equal(sendFromText(crab, "instagram_dm"), "@craboclockfredericksburg");
  assert.equal(sendFromText(crab, "email"), "Crab O Clock's own email");

  const none = outreachProfileOf({ id: "x", name: "S&F Massage Kingdom", sendFromKind: "instagram", sendFrom: "  ", creatorOffer: null });
  assert.equal(none.sendFrom, null);
  assert.equal(none.sendFromKind, null); // a kind without an account means nothing
  assert.equal(senderWithKind(none), null);
  assert.equal(senderMismatch(none, "email"), null);
  assert.equal(sendFromText(none, "tiktok_dm"), "S&F Massage Kingdom's own TikTok");
  assert.equal(sendFromText(none, "email"), "S&F Massage Kingdom's own email");
  // A name that already ends in 's doesn't get a second one.
  assert.equal(sendFromText(outreachProfileOf({ id: "m", name: "Max's", sendFromKind: null, sendFrom: null, creatorOffer: null }), "email"), "Max's own email");
}
assert.equal(guessSendFromKind("@craboclock"), "instagram");
assert.equal(guessSendFromKind("hello@craboclock.com"), "email");
assert.equal(guessSendFromKind("https://www.tiktok.com/@craboclock"), "tiktok");
assert.equal(guessSendFromKind("the front desk phone"), "other");
assert.equal(draftChannel("outreach_email", {}), "email");
assert.equal(draftChannel("outreach_dm", { channel: "tiktok_dm" }), "tiktok_dm");
assert.equal(draftChannel("outreach_dm", {}), "instagram_dm");

/* ── approving an outreach email: the connected Gmail only sends it when a sender is saved AND it IS that sender ── */
// No sender saved: never sent from the shared inbox (it would arrive from Nora's address in the business's voice).
assert.deepEqual(emailSendPlan(null, "nora@example.com"), { auto: false, from: null });
assert.deepEqual(emailSendPlan({ sendFrom: null, sendFromKind: null }, "nora@example.com"), { auto: false, from: null });
assert.deepEqual(emailSendPlan({ sendFrom: "  ", sendFromKind: "email" }, "nora@example.com"), { auto: false, from: null });
assert.deepEqual(emailSendPlan(null, null), { auto: false, from: null });
assert.deepEqual(emailSendPlan({ sendFrom: "@craboclock", sendFromKind: "instagram" }, "nora@example.com"), { auto: false, from: "@craboclock" });
assert.deepEqual(emailSendPlan({ sendFrom: "Hello@CrabOClock.com", sendFromKind: "email" }, "hello@craboclock.com"), { auto: true, from: "Hello@CrabOClock.com" });
assert.deepEqual(emailSendPlan({ sendFrom: "hello@craboclock.com", sendFromKind: "email" }, "nora@example.com"), { auto: false, from: "hello@craboclock.com" });

/* ── written as the business, not as Nora ── */
for (const s of ["Hi! I'm Nora, a Richmond food creator", "This is Nora from @noraeatsgood", "follow @noraeatsgood", "Nora here —", "My name is Nora"]) assert.equal(readsAsNora(s), true, s);
for (const s of ["Hi Jess! We're Crab O Clock in Fredericksburg", "We'd love to host you and a guest", "Our team at S&F Massage Kingdom"]) assert.equal(readsAsNora(s), false, s);

/* ── creator check: never / fresh / stale (over 30 days) ── */
assert.equal(STATS_STALE_DAYS, 30);
assert.deepEqual(statsCheck({ statsCheckedAt: null }, now), { state: "never", days: null, label: "never checked" });
assert.deepEqual(statsCheck({ statsCheckedAt: now }, now), { state: "fresh", days: 0, label: "checked today" });
assert.deepEqual(statsCheck({ statsCheckedAt: daysAgo(3) }, now), { state: "fresh", days: 3, label: "checked 3d ago" });
assert.equal(statsCheck({ statsCheckedAt: daysAgo(30) }, now).state, "fresh"); // 30 days is still fine
assert.deepEqual(statsCheck({ statsCheckedAt: daysAgo(31) }, now), { state: "stale", days: 31, label: "checked 31d ago" });
assert.equal(publicUrl("tiktok.com/@jess"), "https://tiktok.com/@jess");
assert.equal(publicUrl("https://user:pw@example.com/x"), null); // never a login in a link
assert.equal(publicUrl("not a link"), null);

/* ── already featured ── */
assert.equal(alreadyPosted({ stage: "shortlisted", priorPostUrl: null, priorPostFoundAt: null, postUrl: null }), null);
assert.deepEqual(
  alreadyPosted({ stage: "sourced", priorPostUrl: "https://www.tiktok.com/@jess/video/1", priorPostFoundAt: now, postUrl: null }),
  { url: "https://www.tiktok.com/@jess/video/1", prior: true, foundAt: now },
);
assert.deepEqual(alreadyPosted({ stage: "posted", priorPostUrl: null, priorPostFoundAt: null, postUrl: "https://instagram.com/reel/9" }), { url: "https://instagram.com/reel/9", prior: false, foundAt: null });

/* ── Google reviews, per business ── */
const base = { googleLocation: "accounts/1/locations/2", googleSyncAt: daysAgo(0), googleSyncStatus: null, googleSyncCount: null, googleSyncError: null };
{
  const unlinked = googleSyncInfo({ ...base, googleLocation: null, googleSyncStatus: "ok", googleSyncCount: 12 }, true, now);
  assert.equal(unlinked.state, "unlinked");
  assert.equal(unlinked.label, "Not linked");
  assert.equal(unlinked.needsAttention, true);
  assert.equal(googleSyncSentence(unlinked), "Google not linked");

  // A listing is picked but the shared Google account isn't connected: it is not "Connected".
  const off = googleSyncInfo({ ...base, googleSyncStatus: "ok", googleSyncCount: 12 }, false, now);
  assert.equal(off.state, "disconnected");
  assert.equal(off.label, "Google not connected");

  const never = googleSyncInfo({ ...base, googleSyncAt: null }, true, now);
  assert.equal(never.state, "never");
  assert.equal(never.label, "Not synced yet");

  const ok = googleSyncInfo({ ...base, googleSyncStatus: "ok", googleSyncCount: 124 }, true, now);
  assert.deepEqual([ok.state, ok.tone, ok.label, ok.needsAttention, ok.hint], ["ok", "ok", "124 reviews", false, null]);
  assert.equal(googleSyncInfo({ ...base, googleSyncStatus: "ok", googleSyncCount: 1 }, true, now).label, "1 review");

  // A mapped listing that answers with 0 reviews is a warning, not a quiet success.
  const empty = googleSyncInfo({ ...base, googleSyncStatus: "empty", googleSyncCount: 0 }, true, now);
  assert.deepEqual([empty.state, empty.tone, empty.label, empty.needsAttention], ["empty", "warn", "0 reviews", true]);
  assert.equal(empty.hint, "Check it's the right listing.");
  assert.equal(googleSyncSentence(empty), "Google shows 0 reviews — check the listing");

  const err = googleSyncInfo({ ...base, googleSyncStatus: "error", googleSyncError: "Google said no (403)." }, true, now);
  assert.deepEqual([err.state, err.tone, err.label, err.error], ["error", "danger", "Sync failed", "Google said no (403)."]);
  assert.equal(googleSyncSentence(err), "Google review sync failing");

  const stale = googleSyncInfo({ ...base, googleSyncStatus: "ok", googleSyncCount: 40, googleSyncAt: new Date(now.getTime() - (GOOGLE_SYNC_STALE_HOURS + 1) * 3_600_000) }, true, now);
  assert.deepEqual([stale.state, stale.stale, stale.tone, stale.needsAttention], ["ok", true, "warn", true]);
  assert.equal(googleSyncSentence(stale), "Google reviews haven't synced lately");
}

/* ── Google reviews: 0 reviews is normal before opening day and for 30 days after ── */
{
  const day = (n: number) => new Date(now.getTime() + n * 86_400_000).toISOString().slice(0, 10); // n days from "today" (2026-11-14)
  const zero = { ...base, googleSyncStatus: "empty" as const, googleSyncCount: 0 };
  assert.equal(GOOGLE_NEW_LISTING_DAYS, 30);
  assert.equal(isNewListing({ prelaunch: true, openingDate: day(21) }, now), true); // not open yet
  assert.equal(isNewListing({ prelaunch: true, openingDate: null }, now), true); // pre-launch, no date yet
  assert.equal(isNewListing({ prelaunch: false, openingDate: day(-10) }, now), true); // opened 10 days ago
  assert.equal(isNewListing({ prelaunch: true, openingDate: day(-10) }, now), true); // opened, switch still on
  assert.equal(isNewListing({ prelaunch: false, openingDate: day(-29) }, now), true);
  assert.equal(isNewListing({ prelaunch: false, openingDate: day(-30) }, now), false); // a month in: 0 reviews is worth a look
  assert.equal(isNewListing({ prelaunch: true, openingDate: day(-45) }, now), false);
  assert.equal(isNewListing({ prelaunch: false, openingDate: null }, now), false); // an ordinary open business
  assert.equal(isNewListing({}, now), false);

  // The launch checklist has Nora link the listing before opening: 0 reviews then is a quiet success.
  const pre = googleSyncInfo({ ...zero, prelaunch: true, openingDate: day(21) }, true, now);
  assert.deepEqual([pre.state, pre.tone, pre.label, pre.count, pre.hint, pre.needsAttention], ["ok", "ok", "0 reviews", 0, null, false]);
  assert.equal(googleSyncSentence(pre), "0 reviews synced");
  assert.equal(googleSyncInfo({ ...zero, prelaunch: false, openingDate: day(-10) }, true, now).needsAttention, false);
  // ...but a stalled sync on that listing is still raised.
  const preStale = googleSyncInfo({ ...zero, prelaunch: true, openingDate: day(21), googleSyncAt: new Date(now.getTime() - (GOOGLE_SYNC_STALE_HOURS + 1) * 3_600_000) }, true, now);
  assert.deepEqual([preStale.state, preStale.stale, preStale.needsAttention], ["ok", true, true]);
  // A month after opening, and for a business with no opening date, 0 reviews is the warning it always was.
  assert.deepEqual([googleSyncInfo({ ...zero, openingDate: day(-45) }, true, now).state, googleSyncInfo({ ...zero, prelaunch: false, openingDate: null }, true, now).needsAttention], ["empty", true]);
}

/* ── Google reviews: a business with no Google item in its plan isn't expected to have a listing ── */
{
  const quiet = { googleWork: false };
  const unlinked = googleSyncInfo({ ...base, googleLocation: null }, true, now, quiet);
  assert.deepEqual([unlinked.state, unlinked.tone, unlinked.label, unlinked.needsAttention], ["unlinked", "neutral", "Not linked", false]);
  assert.equal(unlinked.hint, "Google isn't in its plan.");
  assert.equal(googleSyncSentence(unlinked), "Google not linked (Google isn't in its plan)");
  const never = googleSyncInfo({ ...base, googleSyncAt: null }, true, now, quiet);
  assert.deepEqual([never.state, never.needsAttention], ["never", false]);
  const zero = googleSyncInfo({ ...base, googleSyncStatus: "empty", googleSyncCount: 0 }, true, now, quiet);
  assert.deepEqual([zero.state, zero.label, zero.needsAttention], ["ok", "0 reviews", false]);
  // A listing someone linked anyway that Google refuses is still a problem worth showing.
  const err = googleSyncInfo({ ...base, googleSyncStatus: "error", googleSyncError: "Google said no (403)." }, true, now, quiet);
  assert.deepEqual([err.state, err.needsAttention], ["error", true]);
  // googleWork: true (or left out) changes nothing.
  assert.equal(googleSyncInfo({ ...base, googleLocation: null }, true, now, { googleWork: true }).needsAttention, true);
  assert.equal(googleSyncInfo({ ...base, googleSyncAt: null }, true, now, {}).needsAttention, true);
}

console.log("outreach-profile + google-status: all checks passed");
