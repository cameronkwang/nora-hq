import { PROFILE_COPY_LIMITS, PROFILE_COPY_SURFACES, type ProfileCopySurface } from "./schema";

/**
 * Profile text (drafts.kind "profile_copy"): an Instagram bio, a TikTok bio or a Google Business description that a
 * person pastes in by hand after approving it. meta.surface says which one; each has the platform's own length limit
 * (PROFILE_COPY_LIMITS). Pure and dependency-free: used by ops (validation), Claude's tools and the review queue.
 */

export const PROFILE_COPY_LABEL: Record<ProfileCopySurface, string> = {
  instagram_bio: "Instagram bio",
  tiktok_bio: "TikTok bio",
  google_description: "Google Business description",
};

export const PROFILE_COPY_PLATFORM: Record<ProfileCopySurface, "instagram" | "tiktok" | "google"> = {
  instagram_bio: "instagram",
  tiktok_bio: "tiktok",
  google_description: "google",
};

/** Where a person pastes it. */
export const PROFILE_COPY_WHERE: Record<ProfileCopySurface, string> = {
  instagram_bio: "Instagram → Edit profile → Bio",
  tiktok_bio: "TikTok → Edit profile → Bio",
  google_description: "Google Business Profile → Edit profile → Description",
};

/** The page to open when pasting it in (the business's own account must be signed in there). TikTok has no web page for it. */
export const PROFILE_COPY_LINK: Partial<Record<ProfileCopySurface, { href: string; label: string }>> = {
  instagram_bio: { href: "https://www.instagram.com/accounts/edit/", label: "Open Instagram profile settings" },
  google_description: { href: "https://business.google.com/locations", label: "Open Google Business Profile" },
};

export function isProfileCopySurface(v: unknown): v is ProfileCopySurface {
  return typeof v === "string" && (PROFILE_COPY_SURFACES as readonly string[]).includes(v);
}

/** The surface saved on a profile_copy draft, or null when it's missing or unknown. */
export function profileCopySurface(meta: Record<string, unknown> | null | undefined): ProfileCopySurface | null {
  const s = meta?.surface;
  return isProfileCopySurface(s) ? s : null;
}

const LINK = /(https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(com|net|org|co|io|us|me|app|shop|menu)\b/i;

export type ProfileCopyCheck = {
  surface: ProfileCopySurface;
  label: string;
  length: number;
  max: number;
  /** Characters over the platform's limit (0 when it fits). */
  over: number;
  /** Worth a second look, but the platform would still take it. */
  warnings: string[];
};

/** Length (as the platforms count it: every UTF-16 unit, so an emoji is 2) against the surface's limit, plus soft checks. */
export function checkProfileCopy(surface: ProfileCopySurface, text: string): ProfileCopyCheck {
  const body = text.trim();
  const max = PROFILE_COPY_LIMITS[surface];
  const warnings: string[] = [];
  if (surface === "google_description") {
    if (LINK.test(body)) warnings.push("Google doesn't allow links in the business description. Take the web address out.");
    if (/\b\d{1,3}\s?% off\b|\$\s?\d/i.test(body)) warnings.push("Google's description is for what the business is, not prices or deals. Keep those for posts.");
  }
  if (surface === "tiktok_bio" && LINK.test(body)) warnings.push("Links typed in a TikTok bio aren't clickable. Use the profile's website field instead.");
  if (body.split("\n").length > (surface === "google_description" ? 8 : 5)) warnings.push("That's a lot of line breaks for a profile. Check how it looks on the phone.");
  return { surface, label: PROFILE_COPY_LABEL[surface], length: body.length, max, over: Math.max(0, body.length - max), warnings };
}

/** "Instagram bio is 12 characters over the 150 limit." */
export function overLimitLine(check: Pick<ProfileCopyCheck, "label" | "over" | "max" | "length">): string {
  return `${check.label} is ${check.length} characters; the limit is ${check.max}. Cut ${check.over}.`;
}
