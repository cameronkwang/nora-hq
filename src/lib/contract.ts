/**
 * Nora's standard client contract: the fields she fills in and the agreement text they produce.
 * Pure (no React, no DB) so the preview and the PDF render the exact same words.
 * Nothing here is saved to the database: the contract lives only in the browser until she downloads it.
 */

export type ContractKind = "collab" | "monthly";

export type ContractFields = {
  kind: ContractKind;
  /** Nora's side. */
  creatorName: string;
  creatorEmail: string;
  /** The client. */
  clientBusiness: string;
  clientContact: string;
  clientEmail: string;
  agreementDate: string; // YYYY-MM-DD
  /** What she delivers. */
  deliverables: string;
  /** collab: the visit / shoot day and when the content goes up. */
  visitDate: string;
  postBy: string;
  /** monthly: when it starts and for how long. */
  startDate: string;
  termMonths: string;
  /** Money. fee is dollars as typed ("450" or "450.00"); empty or 0 = no fee (gifted). */
  fee: string;
  depositPercent: string;
  paymentDays: string;
  /** Rights and logistics. */
  usageMonths: string;
  revisions: string;
  noticeHours: string;
  noticeDays: string;
  state: string;
  extraTerms: string;
};

export const DEFAULT_DELIVERABLES: Record<ContractKind, string> = {
  collab: "1 Instagram Reel (up to 60 seconds) featuring Client, also posted to TikTok\n3 Instagram Stories on the visit day",
  monthly: "8 Instagram feed posts or Reels per month\n12 Instagram Stories per month\nReplies to Google reviews\nLocal creator outreach",
};

/** Nora's legal name: the default "Creator" on every contract (she can still change it). */
export const CREATOR_LEGAL_NAME = "Nora Chen";

export function defaultFields(today: string): ContractFields {
  return {
    kind: "collab",
    creatorName: CREATOR_LEGAL_NAME,
    creatorEmail: "",
    clientBusiness: "",
    clientContact: "",
    clientEmail: "",
    agreementDate: today,
    deliverables: DEFAULT_DELIVERABLES.collab,
    visitDate: "",
    postBy: "",
    startDate: today,
    termMonths: "3",
    fee: "",
    depositPercent: "0",
    paymentDays: "15",
    usageMonths: "6",
    revisions: "1",
    noticeHours: "48",
    noticeDays: "30",
    state: "Virginia",
    extraTerms: "",
  };
}

/**
 * Any stored or posted value → complete ContractFields (every key a string, capped; kind collab unless "monthly").
 * Pure: used by lib/ops-contracts (saving and listing) and lib/ops-invoices (the contract links), so a contract reads
 * the same everywhere.
 */
export function readContractFields(raw: unknown): ContractFields {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out = {} as Record<keyof ContractFields, string>;
  for (const k of Object.keys(defaultFields("2000-01-01")) as (keyof ContractFields)[]) {
    const v = r[k];
    out[k] = typeof v === "string" ? v.slice(0, 5000) : "";
  }
  if (out.kind !== "monthly") out.kind = "collab";
  return out as ContractFields;
}

export type ContractSection = { heading: string; paragraphs: string[] };
export type ContractDoc = {
  title: string;
  intro: string;
  sections: ContractSection[];
  signers: { role: string; name: string; business?: string }[];
};

/* ----------------------------------------------------------------- helpers */

const num = (s: string) => {
  const n = Number(String(s).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const int = (s: string, fallback: number) => {
  const n = Math.round(num(s));
  return n > 0 ? n : fallback;
};

export function money(dollars: number): string {
  return dollars.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: dollars % 1 ? 2 : 0 });
}

/** "2026-11-19" → "November 19, 2026"; empty → "". */
export function longDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

const blank = (s: string, fill: string) => (s.trim() ? s.trim() : fill);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function lines(s: string): string[] {
  return s
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*[-*•]\s*/, "").trim())
    .filter(Boolean);
}

/** What still needs filling in before the contract is worth sending. */
export function missingFields(f: ContractFields): string[] {
  const out: string[] = [];
  if (!f.creatorName.trim()) out.push("your name");
  if (!f.clientBusiness.trim()) out.push("the client's business name");
  if (!f.clientContact.trim()) out.push("the client's contact name");
  if (!lines(f.deliverables).length) out.push("what you'll deliver");
  if (f.kind === "monthly" && !f.startDate) out.push("the start date");
  return out;
}

/* -------------------------------------------------------------- the text */

export function buildContract(f: ContractFields): ContractDoc {
  const me = blank(f.creatorName, "[Your name]");
  const client = blank(f.clientBusiness, "[Client business]");
  const fee = num(f.fee);
  const monthlyKind = f.kind === "monthly";
  // A deposit only applies to a one-time collab; monthly work is invoiced month by month.
  const deposit = monthlyKind ? 0 : Math.min(100, Math.round(num(f.depositPercent)));
  const payDays = int(f.paymentDays, 15);
  const usage = int(f.usageMonths, 6);
  const revisions = Math.round(num(f.revisions));
  const monthly = monthlyKind;

  const sections: ContractSection[] = [];

  // 1. Services
  const items = lines(f.deliverables);
  sections.push({
    heading: "Services",
    paragraphs: [
      monthly
        ? `${me} ("Creator") will provide social media services to ${client} ("Client") each month during the term:`
        : `${me} ("Creator") will create and post the following content featuring ${client} ("Client"):`,
      ...(items.length ? items.map((i) => `•  ${i}`) : ["•  [Deliverables]"]),
      "Creator decides the creative direction, style and editing of the content, keeping it accurate to Client's business.",
    ],
  });

  // 2. Timing
  if (monthly) {
    const months = int(f.termMonths, 3);
    const start = longDate(f.startDate) || "[start date]";
    sections.push({
      heading: "Term",
      paragraphs: [
        `This agreement starts on ${start} and runs for ${plural(months, "month")}. After that it continues month to month until either party ends it under the Cancellation section.`,
      ],
    });
  } else {
    const visit = longDate(f.visitDate);
    const postBy = longDate(f.postBy);
    sections.push({
      heading: "Timing",
      paragraphs: [
        visit
          ? `Creator will visit and film on ${visit}, at a time both parties agree on.`
          : "Creator will visit and film on a date and time both parties agree on in writing (text or email is fine).",
        postBy
          ? `Creator will post the content by ${postBy}, unless both parties agree to a different date.`
          : "Creator will post the content within 14 days of the visit, unless both parties agree to a different date.",
        "Client will make the food, products or experience shown in the content available at no charge on the visit day.",
      ],
    });
  }

  // 3. Fee and payment
  const pay: string[] = [];
  if (fee <= 0) {
    pay.push(
      monthly
        ? "[No fee entered. Enter the monthly fee before sending.]"
        : "There is no fee for this collaboration. In exchange for the content, Client provides the food, products or experience shown at no charge.",
    );
  } else if (monthly) {
    pay.push(`Client will pay Creator ${money(fee)} per month.`);
    pay.push(`Creator will invoice at the start of each month, and each invoice is due within ${plural(payDays, "day")}.`);
  } else {
    pay.push(`Client will pay Creator a flat fee of ${money(fee)}.`);
    if (deposit > 0 && deposit < 100) {
      const dep = Math.round(fee * deposit) / 100;
      pay.push(`A ${deposit}% deposit (${money(dep)}) is due when this agreement is signed and holds the visit date. The remaining ${money(fee - dep)} is due within ${plural(payDays, "day")} after the content is posted.`);
    } else if (deposit >= 100) {
      pay.push("The full fee is due when this agreement is signed.");
    } else {
      pay.push(`The fee is due within ${plural(payDays, "day")} after the content is posted.`);
    }
  }
  if (fee > 0) pay.push("Creator prefers payment by Zelle or cash; a check is also accepted. Creator is responsible for her own taxes and will provide a W-9 on request.");
  sections.push({ heading: monthly ? "Fees and payment" : "Fee and payment", paragraphs: pay });

  // 4. Review and revisions
  sections.push({
    heading: "Review",
    paragraphs: [
      revisions > 0
        ? `Creator may share the content with Client before posting. Client may request up to ${plural(revisions, "round")} of reasonable changes to correct facts (such as prices, menu items or hours). Changes to creative style are at Creator's discretion.`
        : "Creator does not share content for approval before posting, but will promptly correct any factual error (such as prices, menu items or hours) that Client points out.",
    ],
  });

  // 5. Ownership and usage. Monthly work is posted on Client's own accounts, so Client keeps it;
  // a collab is posted on Creator's accounts, so Client gets a time-limited right to repost.
  sections.push(
    monthly
      ? {
          heading: "Ownership and use of the content",
          paragraphs: [
            "Once each month's fee is paid, Client owns the finished posts made for its accounts and may keep and reuse them, including after this agreement ends.",
            "Creator keeps the raw footage and may show the work in her portfolio.",
            "Client gives Creator access to its accounts only as needed for the services, and can remove that access at any time. Creator will not change account passwords or ownership.",
          ],
        }
      : {
          heading: "Ownership and use of the content",
          paragraphs: [
            "Creator owns the content she creates, including the raw footage.",
            `Once any fee is paid in full, Client may share and repost the posted content on Client's own social media accounts and website for ${plural(usage, "month")}, with credit to Creator where the platform allows.`,
            "Using the content in paid ads (including boosting, whitelisting or Spark Ads), in print, or editing it into new content requires Creator's written permission and may carry an additional fee.",
          ],
        },
  );

  // 6. Disclosure (a collab appears on Creator's own accounts, so the FTC wants it labeled)
  if (!monthly) {
    sections.push({
      heading: "Disclosure",
      paragraphs: [
        "Creator will disclose the relationship as the FTC requires, for example with a paid-partnership label, #ad or \"gifted\". Client will not ask Creator to hide or remove the disclosure.",
      ],
    });
  }

  // 7. Cancellation
  if (monthly) {
    const days = int(f.noticeDays, 30);
    sections.push({
      heading: "Cancellation",
      paragraphs: [
        `Either party may end this agreement with ${plural(days, "day")}' written notice (email is fine). Client pays for work done up to the end of the notice period.`,
      ],
    });
  } else {
    const hours = int(f.noticeHours, 48);
    sections.push({
      heading: "Rescheduling and cancellation",
      paragraphs: [
        `Either party may reschedule the visit with at least ${plural(hours, "hour")}' notice.`,
        deposit > 0 && fee > 0
          ? `If Client cancels with less notice, or doesn't reschedule within 30 days, Creator keeps the deposit.`
          : `If Client cancels with less notice, Creator may decline to reschedule.`,
        "If Creator has to cancel, she will reschedule at no extra cost or refund any amount Client has paid.",
      ],
    });
  }

  // 8. No guarantees, relationship, law. Only four states are styled "Commonwealth".
  const stateName = blank(f.state, "Virginia");
  const commonwealth = /^(virginia|kentucky|massachusetts|pennsylvania)$/i.test(stateName);
  sections.push({
    heading: "General",
    paragraphs: [
      "Creator will do her best work, but social media results are not guaranteed: Creator does not promise a specific number of views, followers, sales or reviews.",
      "Creator is an independent contractor, not an employee of Client.",
      "Each party is responsible for its own conduct. Neither party is liable to the other for indirect or lost-profit damages, and Creator's total liability under this agreement is limited to the fees Client has paid.",
      `This agreement is governed by the laws of the ${commonwealth ? "Commonwealth" : "State"} of ${stateName}. It is the whole agreement between the parties, and changes must be in writing (email is fine).`,
    ],
  });

  const extra = lines(f.extraTerms);
  if (extra.length) sections.push({ heading: "Additional terms", paragraphs: extra });

  const dated = longDate(f.agreementDate) || "[date]";
  return {
    title: monthly ? "Social Media Services Agreement" : "Content Collaboration Agreement",
    intro: `This agreement is made on ${dated} between ${me}${f.creatorEmail.trim() ? ` (${f.creatorEmail.trim()})` : ""} and ${client}${f.clientContact.trim() ? `, represented by ${f.clientContact.trim()}` : ""}${f.clientEmail.trim() ? ` (${f.clientEmail.trim()})` : ""}.`,
    sections,
    signers: [
      { role: "Creator", name: me },
      { role: "Client", name: blank(f.clientContact, ""), business: client },
    ],
  };
}

/** A safe file name: "Contract - Pizzeria Delores - 2026-11-17.pdf". */
export function contractFileName(f: ContractFields): string {
  const who = f.clientBusiness.trim().replace(/[^\w &'.-]+/g, "").trim() || "Client";
  return `Contract - ${who} - ${f.agreementDate || "undated"}.pdf`;
}

/* ------------------------------------------------------- from a collab deal */

type DealLike = {
  businessName: string;
  contactName: string | null;
  contactEmail: string | null;
  compType: string;
  amountCents: number | null;
  visitAt: Date | null;
  deliverables: { kind: string; dueDate: string | null }[];
};

const DEAL_DELIVERABLE: Record<string, string> = {
  ig_reel: "Instagram Reel",
  ig_post: "Instagram post",
  ig_story: "Instagram Stories",
  tiktok: "TikTok video",
  photos: "Photos",
  other: "Other content (see notes)",
};

/** The contract fields a collab deal already knows, so "Make contract" opens pre-filled. */
export function fieldsFromDeal(deal: DealLike, timeZone: string): Partial<ContractFields> {
  // "2 Instagram Reel" reads badly, so count each kind and pluralise simply.
  const counts = new Map<string, number>();
  for (const d of deal.deliverables) counts.set(d.kind, (counts.get(d.kind) ?? 0) + 1);
  const deliverables = [...counts].map(([k, n]) => {
    const label = DEAL_DELIVERABLE[k] ?? k;
    if (label.endsWith("s")) return n > 1 ? `${n} sets of ${label}` : label; // "Instagram Stories", "Photos"
    return n > 1 ? `${n} ${label}s` : `1 ${label}`;
  });
  const dues = deal.deliverables.map((d) => d.dueDate).filter((d): d is string => !!d).sort();
  const visitDate = deal.visitAt ? new Intl.DateTimeFormat("en-CA", { timeZone }).format(deal.visitAt) : "";
  const paid = deal.compType === "paid" || deal.compType === "paid_hosted";
  return {
    kind: "collab",
    clientBusiness: deal.businessName,
    clientContact: deal.contactName ?? "",
    clientEmail: deal.contactEmail ?? "",
    ...(deliverables.length ? { deliverables: deliverables.join("\n") } : {}),
    visitDate,
    postBy: dues.length ? dues[dues.length - 1] : "",
    fee: paid && deal.amountCents ? String(deal.amountCents / 100) : "",
  };
}
