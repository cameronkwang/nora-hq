/**
 * Short fingerprint of the parts of a calendar post a reviewer sees next to a post draft (media, time, format,
 * publishing mode). The review page submits it with Approve; approveDraft refuses if the post has changed since,
 * so a person never approves (and auto-schedules) something different from what they looked at.
 * Pure (no server-only imports) so both the review UI and lib/ops can use it.
 */
export function postReviewKey(p: {
  platform: string;
  format: string;
  mediaUrls: string[];
  scheduledFor: Date | string | null;
  publishMode: string;
}): string {
  const when = p.scheduledFor ? new Date(p.scheduledFor).toISOString() : "";
  const s = JSON.stringify([p.platform, p.format, p.mediaUrls, when, p.publishMode]);
  // FNV-1a 32-bit, twice with different seeds → 16 hex chars. Not security-sensitive: it detects change, not tampering.
  const h = (seed: number) => {
    let x = seed >>> 0;
    for (let i = 0; i < s.length; i++) {
      x ^= s.charCodeAt(i);
      x = Math.imul(x, 0x01000193) >>> 0;
    }
    return x.toString(16).padStart(8, "0");
  };
  return `${h(0x811c9dc5)}${h(0x9e3779b9)}`;
}
