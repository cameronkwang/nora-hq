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
import { GOOGLE_SYNC_STALE_HOURS, googleSyncInfo, googleSyncSentence } from "../src/lib/google-status";

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
}
assert.equal(guessSendFromKind("@craboclock"), "instagram");
assert.equal(guessSendFromKind("hello@craboclock.com"), "email");
assert.equal(guessSendFromKind("https://www.tiktok.com/@craboclock"), "tiktok");
assert.equal(guessSendFromKind("the front desk phone"), "other");
assert.equal(draftChannel("outreach_email", {}), "email");
assert.equal(draftChannel("outreach_dm", { channel: "tiktok_dm" }), "tiktok_dm");
assert.equal(draftChannel("outreach_dm", {}), "instagram_dm");

/* ── approving an outreach email: the connected Gmail only sends it when it IS the business's sender ── */
assert.deepEqual(emailSendPlan(null, "nora@example.com"), { auto: true, from: "nora@example.com" }); // no sender saved: as before
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

console.log("outreach-profile + google-status: all checks passed");
