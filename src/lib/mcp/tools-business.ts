import "server-only";
import { z } from "zod";
import { and, desc, eq, like } from "drizzle-orm";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { getDb, schema } from "@/lib/db";
import { OpsError } from "@/lib/ops";
import { SERVICES } from "@/lib/onboard-services";
import { createBusiness, setBusinessActive, setBusinessFacts, setPlan, updateBusinessDetails } from "@/lib/ops-business";
import { FACT_LABEL, PRICE_RANGES, factsChecklist, ownerCardFacts, sourceLabel, type FactKey, type FactsChecklist } from "@/lib/business-facts";
import { getOnboardingStatus } from "@/lib/ops-onboarding";
import { createIntakeLink, getClientIntakeStatus } from "@/lib/ops-intake";
import { INTAKE_COPY, INTAKE_LANG_CODES, INTAKE_LANG_TAG } from "@/lib/intake-copy";
import { absUrl, type Ctx } from "./queries";

/**
 * Claude's business tools: set up a business, edit its details and monthly plan, switch it Active/Inactive,
 * save the public facts it looked up (set_business_facts), get the onboarding form link (for a PERSON to text)
 * once those facts were researched, and check on it.
 * Claude uses these only when Nora or Cameron asked — in chat or in an ask. Passwords are always refused.
 * Wired in by the integrator: registerBusinessTools(server, ctx) in src/lib/mcp/server.ts.
 */

const ACTOR = "claude";

class ToolError extends Error {}

function compactJson(data: unknown): string {
  return JSON.stringify(data, (_k, v) => (v === null || v === undefined || v === "" ? undefined : v));
}

function errorMessage(e: unknown): string {
  if (e instanceof z.ZodError) return `Invalid input — ${e.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ")}`;
  if (e instanceof ToolError || e instanceof OpsError) return e.message;
  console.error("[mcp] tool error", e);
  return `Something went wrong in Nora HQ: ${e instanceof Error ? e.message : String(e)}`;
}

async function run(fn: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return { content: [{ type: "text", text: compactJson(await fn()) }] };
  } catch (e) {
    return { content: [{ type: "text", text: errorMessage(e) }], isError: true };
  }
}

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;

const ONLY_WHEN_ASKED =
  "Use ONLY when Nora or Cameron asked for this (in chat or in an ask) — never on your own initiative; if you think it's needed, suggest it in the ask thread instead. ";
const NO_PASSWORDS =
  "Never pass passwords, PINs or logins: any value that looks like one is refused. If a person gives you a password, don't save it anywhere — tell them to keep it in a password manager and to remove it from wherever they pasted it. ";

const clientId = z.string().min(1).describe("Business id (slug) — from list_clients or get_briefing.");
const areas = z.union([z.string(), z.array(z.string())]).describe("Where to look for local creators, e.g. \"Richmond, 757 / Hampton Roads\".");

async function businessLabel(id: string) {
  const db = await getDb();
  const [c] = await db.select().from(schema.clients).where(eq(schema.clients.id, id));
  if (!c) throw new ToolError(`No business with id "${id}". Use list_clients.`);
  return c;
}

/** The facts as the tools name them (snake_case) ⇄ as they're stored. */
const FACT_ARG = {
  address: "address", phone: "phone", hours: "hours", website: "website", instagram: "instagram", tiktok: "tiktok",
  facebook: "facebook", google_listing: "googleListing", sells: "sells", price_range: "priceRange",
} as const satisfies Record<string, FactKey>;
const FACT_ARGS = Object.keys(FACT_ARG) as [keyof typeof FACT_ARG, ...(keyof typeof FACT_ARG)[]];
const argFor = (key: FactKey) => FACT_ARGS.find((a) => FACT_ARG[a] === key) ?? key;

const RESEARCH_HOW =
  "Look each one up in public sources (Google Maps, the business's own website, its Instagram / Facebook / TikTok) and save it with set_business_facts " +
  "(value + the web address you found it at). Couldn't find one? Save it with not_found: true. Never guess, and never ask the owner.";

/** The prefill checklist, in plain words: what the form can already show the owner, and what nobody has looked up. */
function prefillChecklist(check: FactsChecklist) {
  return {
    alreadyKnown: check.known.map((k) => `${k.label}: ${k.value.replace(/\s*\n\s*/g, " / ")}${k.source ? ` (from ${sourceLabel(k.source)})` : ""}`),
    lookedForNotFound: check.notFound.length ? check.notFound.map((k) => k.label) : undefined,
    missing: check.missing.length ? check.missing.map((k) => `${k.label} (fact: ${argFor(k.key)})`) : undefined,
    lastChecked: check.checkedAt ? `${check.checkedAt.slice(0, 10)} by ${check.checkedBy ?? "someone"}` : undefined,
  };
}

/** Has the team finished with a submitted form? True once the "Onboarding form received" ask is done/archived. */
async function intakeProcessed(clientIdValue: string, submittedAt: Date | null): Promise<boolean> {
  const db = await getDb();
  const asks = await db.select({ status: schema.asks.status, createdAt: schema.asks.createdAt }).from(schema.asks)
    .where(and(eq(schema.asks.clientId, clientIdValue), eq(schema.asks.createdBy, "public"), like(schema.asks.body, "Onboarding form received for%")))
    .orderBy(desc(schema.asks.createdAt)).limit(5);
  const latest = asks.find((a) => !submittedAt || a.createdAt.getTime() >= submittedAt.getTime() - 60_000) ?? asks[0];
  return !!latest && (latest.status === "done" || latest.status === "archived");
}

export function registerBusinessTools(server: McpServer, ctx: Ctx) {
  server.registerTool("create_business", {
    title: "Set up a new business",
    description:
      ONLY_WHEN_ASKED +
      "Adds a business we now manage: a starting monthly plan for the services, a Getting started checklist for Nora/Cameron, and a research ask for you. " +
      "If a business with a similar name (same location) already exists, nothing is created and you get its id back — then use update_business. " +
      "Two locations of one brand are two businesses: include location. Handles can be @handles or profile links. " +
      "The owner email for reports is set by Nora or Cameron in Settings — if you were given one, mention it in the ask thread. " +
      "After it's created, work its \"New client\" research ask: look up the public facts (set_business_facts), then get the onboarding form link ready with send_onboarding_form. " +
      NO_PASSWORDS,
    inputSchema: {
      name: z.string().min(1).max(200).describe("Business name, as the owner writes it."),
      location: z.string().max(200).optional().describe("City / neighbourhood, e.g. \"Richmond\" or \"Virginia Beach\"."),
      services: z.array(z.enum(SERVICES)).min(1).describe("What we do for them: instagram, facebook, tiktok, google (review replies), creators (local creator outreach), collab (Nora visits & posts)."),
      instagram: z.string().max(300).optional(),
      tiktok: z.string().max(300).optional(),
      website: z.string().max(500).optional(),
      outreach_areas: areas.optional(),
      notes: z.string().max(5000).optional().describe("What the person told you about them (contacts, preferences). No passwords."),
      confirm_different: z.boolean().optional().describe("Only after create_business said a business \"may be the same\" and a person confirmed it's a different one (e.g. another location)."),
    },
    annotations: WRITE,
  }, async (a) => run(async () => {
    const r = await createBusiness({
      name: a.name, location: a.location, services: a.services, instagramHandle: a.instagram, tiktokHandle: a.tiktok,
      website: a.website, outreachAreas: a.outreach_areas, notes: a.notes, confirmDifferent: a.confirm_different,
    }, ACTOR);
    return { ...r, page: absUrl(ctx, `/clients/${r.id}`) };
  }));

  server.registerTool("update_business", {
    title: "Update a business's details",
    description:
      ONLY_WHEN_ASKED +
      "Changes only the fields you pass; an empty string clears a field (not name). notes are ADDED as a new dated paragraph — you can't replace or delete notes. " +
      "brand_voice replaces the whole brand voice: read the current one first (list_clients) and send the full new text. " +
      "You can't change the Google location or the owner email that receives reports (a person sets those in Settings). Returns each change as before → after. " +
      "Outreach profile (send_from, send_from_kind, creator_offer): the account creator outreach is sent from — the business's own, never Nora's — and the standing offer for creators. " +
      "Save these only with the exact account and offer Nora or Cameron gave you; never guess a sender or make up an offer. " +
      NO_PASSWORDS,
    inputSchema: {
      client_id: clientId,
      name: z.string().min(1).max(200).optional(),
      location: z.string().max(200).optional(),
      brand: z.string().max(200).optional().describe("Brand group shared by every location."),
      instagram: z.string().max(300).optional(),
      tiktok: z.string().max(300).optional(),
      website: z.string().max(500).optional(),
      outreach_areas: areas.optional(),
      brand_voice: z.string().max(8000).optional(),
      add_note: z.string().max(5000).optional().describe("Appended to the business notes."),
      send_from: z.string().max(200).optional().describe("Outreach profile: the business's own account that creator outreach goes out from, e.g. \"@craboclockfredericksburg\" or an email address. Not a password or login."),
      send_from_kind: z.enum(schema.SEND_FROM_KINDS).optional().describe("What send_from is: instagram, tiktok, email or other. Left out, it's worked out from the value."),
      creator_offer: z.string().max(300).optional().describe("Outreach profile: the standing offer for creators, exactly as the owner agreed it, e.g. \"Free all-you-can-eat seafood boil for 2\"."),
    },
    annotations: WRITE,
  }, async (a) => run(async () => {
    const c = await businessLabel(a.client_id);
    const r = await updateBusinessDetails(a.client_id, {
      name: a.name, location: a.location, brand: a.brand, instagramHandle: a.instagram, tiktokHandle: a.tiktok, website: a.website,
      outreachAreas: a.outreach_areas, brandVoice: a.brand_voice,
      sendFrom: a.send_from, sendFromKind: a.send_from_kind, creatorOffer: a.creator_offer,
      ...(a.add_note !== undefined ? { notes: a.add_note, notesMode: "append" as const } : {}),
    }, ACTOR);
    return { business: c.name, client_id: c.id, changed: r.changed.length ? r.changed : undefined, note: r.changed.length ? undefined : "Nothing changed — the values were already the same." };
  }));

  server.registerTool("set_business_facts", {
    title: "Save a business's public facts",
    description:
      "Saves PUBLIC facts you looked up about a business — address, phone, opening hours, website, Instagram, TikTok, Facebook Page, Google listing link, what they sell, price range — " +
      "so the onboarding form can show them to the owner as one \"Is this right?\" card. Owners are busy: every fact you find is one they don't have to type. " +
      "Use it when Nora or Cameron asked, or when a \"New client …\" research ask, an \"Onboarding form received\" ask or a \"Business details to fix\" ask tells you to (those asks are your go-ahead). " +
      "Public facts only — what anyone can see on Google Maps, the business's own website or its social profiles. Every value needs `source`: the web address where you found it. Never guess. " +
      "Looked and couldn't find one? Send it with not_found: true (that never removes a value that's already saved). You can't clear a fact; a wrong name is changed by a person in Settings. " +
      "Only when working a \"Business details to fix\" ask, and the owner's own correction is the best source (new hours, a new phone number), use source \"owner\". " +
      "Returns each change as before → after, plus what is still missing before the form can go out. " +
      NO_PASSWORDS,
    inputSchema: {
      client_id: clientId,
      facts: z.array(z.object({
        fact: z.enum(FACT_ARGS).describe("Which fact. hours = opening hours (one line per day or range is fine); google_listing = the Google Maps link to their listing; sells = what they sell in a few words (\"Sichuan hot pot, bubble tea\"); price_range = one of " + PRICE_RANGES.join(" ") + "."),
        value: z.string().max(2000).optional().describe("The fact as found. Handles can be @handles or profile links; facebook is the Page link."),
        source: z.string().max(600).optional().describe("Web address where you found it (https://…). Required with value."),
        not_found: z.boolean().optional().describe("true = you looked in public sources and couldn't find it."),
      })).min(1).max(20),
    },
    annotations: { ...WRITE, idempotentHint: true },
  }, async ({ client_id, facts }) => run(async () => {
    const c = await businessLabel(client_id);
    const r = await setBusinessFacts(client_id, facts.map((f) => ({ fact: FACT_ARG[f.fact], value: f.value, source: f.source, notFound: f.not_found })), ACTOR);
    const missing = r.checklist.missing.map((m) => m.label);
    return {
      business: c.name,
      client_id,
      changed: r.changed.length ? r.changed : undefined,
      kept: r.kept.length ? r.kept : undefined,
      note: r.changed.length || r.kept.length ? undefined : "Nothing changed — the values were already the same.",
      ...prefillChecklist(r.checklist),
      readyToSendForm: r.checklist.researched,
      next: missing.length
        ? `Still to look up: ${missing.join(", ")}. ${RESEARCH_HOW}`
        : "Every fact is saved or marked not found. If a person (or the business's research ask) wants the onboarding form, send_onboarding_form now returns the link for them to text.",
    };
  }));

  server.registerTool("set_plan", {
    title: "Change a business's monthly plan",
    description:
      ONLY_WHEN_ASKED +
      "Adds, updates or turns off monthly plan items (what we deliver every month). Match an item by deliverable_id (from list_clients monthlyPlan) or by its exact title; " +
      "an unknown title creates a new item (platform required). Items you don't list stay as they are. Nothing is deleted: active false turns an item off. " +
      "target_per_month 0 means \"as needed\" (e.g. reply to every Google review). Platform facebook = Facebook Page posts (posted by hand). " +
      "After changing the plan, generate_month_tasks adds this month's checklist tasks for new items.",
    inputSchema: {
      client_id: clientId,
      items: z.array(z.object({
        deliverable_id: z.string().optional(),
        title: z.string().max(200).optional(),
        platform: z.enum(schema.PLATFORMS).optional(),
        target_per_month: z.number().int().min(0).max(999).optional(),
        active: z.boolean().optional(),
      })).min(1).max(30),
    },
    annotations: { ...WRITE, idempotentHint: true },
  }, async ({ client_id, items }) => run(async () => {
    const c = await businessLabel(client_id);
    const r = await setPlan(client_id, items.map((i) => ({
      deliverableId: i.deliverable_id, title: i.title, platform: i.platform, targetPerMonth: i.target_per_month, active: i.active,
    })), ACTOR);
    return { business: c.name, client_id, changed: r.changed.length ? r.changed : undefined, plan: r.plan };
  }));

  server.registerTool("set_business_status", {
    title: "Set a business Active or Inactive",
    description:
      ONLY_WHEN_ASKED +
      "Active businesses show on Home, in the sidebar and in your briefing. Inactive hides them everywhere (nothing is deleted; history stays) — " +
      "use it when we stop or pause working with a business, and set it back to active when we start again. Nora's own workspace is always active.",
    inputSchema: { client_id: clientId, active: z.boolean() },
    annotations: { ...WRITE, idempotentHint: true },
  }, async ({ client_id, active }) => run(async () => {
    const c = await businessLabel(client_id);
    const r = await setBusinessActive(client_id, active, ACTOR);
    return { business: c.name, client_id, status: active ? "active" : "inactive", changed: r.changed };
  }));

  server.registerTool("send_onboarding_form", {
    title: "Get the onboarding form link to send",
    description:
      "Use when Nora or Cameron asked for it (in chat or in an ask), or when the business's \"New client …\" research ask tells you to get the link ready — never on your own initiative otherwise. " +
      "Gets the business's private welcome/onboarding form link (/start/…) and ready-to-text messages in English, 简体 and 繁體 for Nora or Cameron to send. " +
      "RESEARCH COMES FIRST: the form shows the owner what we already know (name, address, hours, phone, website, Instagram, TikTok, Facebook) as one \"Is this right?\" card, so a busy owner only taps Yes. " +
      "This tool always returns the prefill checklist (what we know, what's missing). It returns the link only once every public fact was saved or marked not found with set_business_facts; " +
      "until then it tells you what to look up. send_anyway: true skips that, ONLY when Nora or Cameron told you to send it as it is. " +
      "YOU NEVER SEND IT: paste the link and messages back to the person and say they need to text it to the owner. " +
      "If a link was already made and still works, you get that same link (it's never replaced). If the owner already sent the form, read it with get_client_intake instead. " +
      "The link is private: only share it with Nora or Cameron.",
    inputSchema: {
      client_id: clientId,
      send_anyway: z.boolean().optional().describe("true ONLY when Nora or Cameron said to send the form without the missing facts (say so in your reply). Never set it on your own."),
    },
    annotations: WRITE,
  }, async ({ client_id, send_anyway }) => run(async () => {
    const c = await businessLabel(client_id);
    if (c.kind === "creator") throw new ToolError("The onboarding form is for businesses we manage.");
    const { submitted } = await getClientIntakeStatus(client_id);
    if (submitted) throw new ToolError(`${c.name} already sent their onboarding form — read it with get_client_intake. Only Nora or Cameron can send a new one (from the business page).`);
    const check = factsChecklist(c);
    const prefill = prefillChecklist(check);
    const preview = absUrl(ctx, `/start-preview/${client_id}`);
    if (!check.researched && !send_anyway) {
      // No link yet (and none is created): the research hasn't been attempted for every fact.
      return {
        business: c.name,
        client_id,
        linkReady: false,
        prefill,
        next:
          `No link yet: ${check.missing.map((m) => m.label).join(", ")} ${check.missing.length === 1 ? "hasn't" : "haven't"} been looked up. ${RESEARCH_HOW} ` +
          "Then call send_onboarding_form again. If Nora or Cameron told you to send it as it is, call again with send_anyway: true.",
        previewForTheTeam: preview,
      };
    }
    const link = await createIntakeLink(client_id, ACTOR, { origin: ctx.baseUrl });
    const url = absUrl(ctx, link.url);
    const card = ownerCardFacts(c);
    return {
      business: c.name,
      client_id,
      linkReady: true,
      url,
      reusedExistingLink: link.reused || undefined,
      sentWithoutResearch: check.researched ? undefined : `A person asked to send it anyway. Still not looked up: ${check.missing.map((m) => m.label).join(", ")}.`,
      prefill,
      ownerWillSee: card.length
        ? `One "Is this right?" card with the name plus: ${card.map((f) => FACT_LABEL[f.key]).join(", ")}. They tap "Yes, that's right" or "Something's off".`
        : "No \"Is this right?\" card — we have no facts to show, so they only give their name and a phone or email.",
      messages: Object.fromEntries(INTAKE_LANG_CODES.map((code) => [INTAKE_LANG_TAG[code], INTAKE_COPY[code].share.message(c.name, url)])),
      howToSend: "Not sent. Give these to Nora or Cameron to text the owner (pick the owner's language). Nothing is sent by Nora HQ or by you.",
      previewForTheTeam: preview,
      teamView: absUrl(ctx, `/clients/${client_id}`),
    };
  }));

  server.registerTool("get_onboarding_status", {
    title: "Onboarding status",
    description:
      "Where a business is in onboarding: the public facts we hold for the form's \"Is this right?\" card (known / looked for and not found / still missing), " +
      "the welcome form (not sent / sent / opened / submitted / expired, with dates; whether the team has processed the answers) " +
      "and the Getting started checklist (done of total, open steps and who they're for). Read the answers themselves with get_client_intake.",
    inputSchema: { client_id: clientId },
    annotations: READ,
  }, async ({ client_id }) => run(async () => {
    const c = await businessLabel(client_id);
    const [{ latest, submitted }, steps] = await Promise.all([getClientIntakeStatus(client_id), getOnboardingStatus(client_id)]);
    const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : undefined);
    const form = submitted
      ? { status: "submitted", sentOn: day(submitted.createdAt), openedOn: day(submitted.openedAt), submittedOn: day(submitted.submittedAt), answeredIn: submitted.lang ?? undefined, processed: await intakeProcessed(client_id, submitted.submittedAt) }
      : latest
        ? { status: latest.status, sentOn: day(latest.createdAt), openedOn: day(latest.openedAt), expiresOn: day(latest.expiresAt) }
        : { status: "not_sent" };
    const check = factsChecklist(c);
    return {
      business: c.name,
      client_id,
      active: !c.archived,
      publicFacts: c.kind === "creator" ? undefined : { ...prefillChecklist(check), researched: check.researched },
      form,
      gettingStarted: steps.total
        ? { done: steps.done, total: steps.total, open: steps.tasks.filter((t) => t.status !== "done").map((t) => ({ title: t.title, for: t.assignee, status: t.status })) }
        : undefined,
      next:
        form.status === "not_sent" || form.status === "expired" || form.status === "revoked"
          ? (check.researched
              ? "No working form link. If asked, get one with send_onboarding_form for a person to text."
              : `No working form link, and some public facts haven't been looked up (${check.missing.map((m) => m.label).join(", ")}): save them with set_business_facts first, then send_onboarding_form gives a person the link to text.`)
          : form.status === "submitted"
            ? ("processed" in form && form.processed ? "Answers processed." : "Answers are in — read them with get_client_intake and work the \"Onboarding form received\" ask.")
            : "Waiting on the owner. If it's been a few days, suggest a friendly nudge (a task for Nora) — don't contact the owner yourself.",
    };
  }));
}
