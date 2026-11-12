/**
 * Everything the public "Collab with Nora" page (/collab) says, in one place.
 *
 * Edit labels, hints and paragraphs freely. Leave each option's `value` alone once requests have come in:
 * values are what's stored, and the inbox / Claude read them back through these same lists.
 * Safe to import from client components (no server code here).
 */

export type Option = { value: string; label: string; hint?: string };

export const COLLAB_COPY = {
  pageTitle: "Collab with Nora",
  metaDescription: "Work with Nora (@noraeatsgood) — tell her about your spot and what you have in mind.",
  title: "Collab with Nora",
  handle: "@noraeatsgood",
  intro:
    "I'm Nora, a food creator sharing spots worth the trip. If you'd like to work together, tell me a bit about your place and what you have in mind — I read every request and reply within a few days.",
  timeNote: "Takes about 3 minutes.",
  steps: [
    { title: "About you", blurb: "Who you are and where to find you." },
    { title: "The collab", blurb: "What you have in mind. Rough answers are fine." },
    { title: "Details", blurb: "The good stuff — this is what helps me plan a great visit." },
  ],
  acks: {
    disclosure: "Sponsored and gifted content is always clearly disclosed (#ad / Paid partnership / “gifted”) per FTC guidelines.",
    honest: "Reviews are honest — a collab doesn’t guarantee positive coverage.",
  },
  budgetHint: "Paid collabs start at $600 — pick the closest range, or “Custom package” and we’ll shape one together. Paid usage (ads/whitelisting) is priced separately.",
  /** Shown under the intro when the media kit's "Show rate" is on (the line itself is set in the media kit settings). */
  mediaKitLink: "See my media kit",
  paidUsageNote: "Paid usage is priced separately.",
  submit: "Send request",
  sending: "Sending…",
  next: "Next",
  back: "Back",
  thanksTitle: (name: string) => `Thanks, ${name}!`,
  thanksBody: (email: string) => `Nora got your request and will reply to ${email} within a few business days.`,
  thanksFoot: "In the meantime, say hi on Instagram or TikTok — @noraeatsgood.",
  rateLimited: "Looks like a few requests came from here already. Nora will be in touch — no need to send it again.",
  genericError: "Something went wrong sending that. Please try again in a minute.",
  fixErrors: "A couple of things need a look before this can go through.",
  footer: "Your details go only to Nora and are used to reply to your request.",
} as const;

export const ROLES: Option[] = [
  { value: "owner", label: "Owner" },
  { value: "manager", label: "Manager" },
  { value: "marketing", label: "Marketing" },
  { value: "agency", label: "Agency" },
  { value: "pr", label: "PR" },
];

export const BUSINESS_TYPES: Option[] = [
  { value: "restaurant", label: "Restaurant" },
  { value: "cafe_bakery", label: "Café / bakery" },
  { value: "bar", label: "Bar" },
  { value: "food_truck", label: "Food truck" },
  { value: "packaged", label: "Packaged food / beverage brand" },
  { value: "event", label: "Event / festival" },
  { value: "hospitality_group", label: "Hospitality group" },
  { value: "other", label: "Other" },
];

export const INTERESTS: Option[] = [
  { value: "dine_in", label: "Dine-in feature / tasting" },
  { value: "launch", label: "New menu or launch" },
  { value: "event", label: "Event coverage" },
  { value: "product", label: "Packaged product feature" },
  { value: "recurring", label: "Recurring partnership" },
  { value: "ugc", label: "UGC for your channels", hint: "Content for you to post — not on my page" },
  { value: "giveaway", label: "Giveaway" },
];

export const DELIVERABLES: Option[] = [
  { value: "ig_reel", label: "Instagram Reel" },
  { value: "ig_post", label: "Instagram carousel / post" },
  { value: "ig_stories", label: "Instagram Stories" },
  { value: "tiktok", label: "TikTok video" },
  { value: "photos", label: "Photos for your use" },
];

export const COMPENSATION: Option[] = [
  { value: "paid", label: "Paid collaboration" },
  { value: "paid_hosted", label: "Paid + hosted meal" },
  { value: "gifted", label: "Hosted meal / product only", hint: "Gifted" },
  { value: "affiliate", label: "Commission / affiliate" },
  { value: "unsure", label: "Not sure yet" },
];
/** Compensation values that show the budget question. */
export const PAID_COMPENSATION = ["paid", "paid_hosted"] as const;

/** Nora's public rate line — the default for the media kit (Settings live in app_settings "media_kit"). */
export const DEFAULT_RATE_LINE = "Collabs start at $600 — custom packages available; reach out to Nora directly.";

/**
 * Budget ranges offered on the form (paid collabs start at $600). "1000_2500" and "2500_plus" keep the values
 * the earlier list used, so old answers read the same. Retired values still display via LEGACY_LABELS.
 */
export const BUDGETS: Option[] = [
  { value: "600_1000", label: "$600–$1,000" },
  { value: "1000_2500", label: "$1,000–$2,500" },
  { value: "2500_plus", label: "$2,500+" },
  { value: "custom", label: "Custom package — let’s talk" },
  { value: "gifted_only", label: "Gifted / hosted only" },
];

/** Labels for option values no longer offered, so requests stored before a list changed still read nicely. */
const LEGACY_LABELS: Record<string, string> = {
  under_250: "Under $250",
  "250_500": "$250–500",
  "500_1000": "$500–1,000",
  discuss: "Prefer to discuss",
};

export const USAGE: Option[] = [
  { value: "organic", label: "Organic — shared on Nora’s page only" },
  { value: "repost", label: "Reposting on your channels too" },
  { value: "paid_ads", label: "Paid ads / whitelisting", hint: "Priced separately" },
];

export const HEARD_FROM: Option[] = [
  { value: "instagram", label: "Instagram" },
  { value: "tiktok", label: "TikTok" },
  { value: "referral", label: "A friend or another business" },
  { value: "creator", label: "Another creator" },
  { value: "search", label: "Google / search" },
  { value: "other", label: "Other" },
];

/** Field labels and placeholders, keyed by form field name. */
export const FIELDS = {
  businessName: { label: "Business name", placeholder: "" },
  contactName: { label: "Your name", placeholder: "" },
  role: { label: "Your role" },
  email: { label: "Email", placeholder: "you@yourplace.com" },
  phone: { label: "Phone", placeholder: "Optional" },
  businessType: { label: "Type of business" },
  instagram: { label: "Instagram", placeholder: "@yourplace" },
  tiktok: { label: "TikTok", placeholder: "@yourplace" },
  website: { label: "Website", placeholder: "yourplace.com" },
  city: { label: "City / area", placeholder: "e.g. Richmond, VA" },
  address: { label: "Address or neighborhood", placeholder: "Optional" },
  interests: { label: "What are you interested in?", hint: "Pick any that fit." },
  deliverables: { label: "Deliverables you’re hoping for", hint: "Optional — I can suggest a mix." },
  compensation: { label: "Compensation" },
  budget: { label: "Budget range" },
  idealDate: { label: "Ideal timing" },
  flexible: { label: "I’m flexible" },
  deadline: { label: "Any hard deadline?", placeholder: "e.g. launch on the 14th" },
  usage: { label: "Content usage" },
  exclusivity: { label: "Exclusivity needs", placeholder: "Leave blank if none" },
  special: { label: "What makes your spot or product special?", placeholder: "Signature dishes, your story, anything you’re proud of" },
  dietary: { label: "Dietary / menu notes", placeholder: "Vegan or gluten-free options, halal, allergens to know about" },
  bestTimes: { label: "Best days / times to visit or film", placeholder: "e.g. weekday afternoons" },
  restrictions: { label: "Any filming restrictions?", placeholder: "Busy hours, staff on camera, lighting" },
  links: { label: "Links", placeholder: "Menu, press kit, Drive folder — one per line" },
  heardFrom: { label: "How did you hear about me?" },
  anythingElse: { label: "Anything else?", placeholder: "" },
} as const;

export type CollabField = keyof typeof FIELDS | "ackDisclosure" | "ackHonest";

/** Which step (0-based) each field lives on — used to jump to the first error. */
export const FIELD_STEP: Record<CollabField, 0 | 1 | 2> = {
  businessName: 0, contactName: 0, role: 0, email: 0, phone: 0, businessType: 0, instagram: 0, tiktok: 0, website: 0, city: 0, address: 0,
  interests: 1, deliverables: 1, compensation: 1, budget: 1, idealDate: 1, flexible: 1, deadline: 1, usage: 1, exclusivity: 1,
  special: 2, dietary: 2, bestTimes: 2, restrictions: 2, links: 2, heardFrom: 2, anythingElse: 2, ackDisclosure: 2, ackHonest: 2,
};

export function optionLabel(list: Option[], value: string | null | undefined): string {
  if (!value) return "";
  return list.find((o) => o.value === value)?.label ?? LEGACY_LABELS[value] ?? value;
}

export function optionLabels(list: Option[], values: unknown): string[] {
  return Array.isArray(values) ? values.map((v) => optionLabel(list, String(v))).filter(Boolean) : [];
}
