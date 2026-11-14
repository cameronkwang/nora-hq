import "server-only";
import { z } from "zod";
import { and, desc, eq, like } from "drizzle-orm";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { getDb, schema } from "@/lib/db";
import { OpsError } from "@/lib/ops";
import { SERVICES } from "@/lib/onboard-services";
import { createBusiness, setBusinessActive, setPlan, updateBusinessDetails } from "@/lib/ops-business";
import { getOnboardingStatus } from "@/lib/ops-onboarding";
import { createIntakeLink, getClientIntakeStatus } from "@/lib/ops-intake";
import { INTAKE_COPY, INTAKE_LANG_CODES, INTAKE_LANG_TAG } from "@/lib/intake-copy";
import { absUrl, type Ctx } from "./queries";

/**
 * Claude's business tools: set up a business, edit its details and monthly plan, switch it Active/Inactive,
 * get the onboarding form link (for a PERSON to text) and check on it.
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
  const [c] = await db.select({ id: schema.clients.id, name: schema.clients.name, kind: schema.clients.kind, archived: schema.clients.archived })
    .from(schema.clients).where(eq(schema.clients.id, id));
  if (!c) throw new ToolError(`No business with id "${id}". Use list_clients.`);
  return c;
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
      "After it's created, offer to get the onboarding form link with send_onboarding_form. " +
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
    },
    annotations: WRITE,
  }, async (a) => run(async () => {
    const c = await businessLabel(a.client_id);
    const r = await updateBusinessDetails(a.client_id, {
      name: a.name, location: a.location, brand: a.brand, instagramHandle: a.instagram, tiktokHandle: a.tiktok, website: a.website,
      outreachAreas: a.outreach_areas, brandVoice: a.brand_voice,
      ...(a.add_note !== undefined ? { notes: a.add_note, notesMode: "append" as const } : {}),
    }, ACTOR);
    return { business: c.name, client_id: c.id, changed: r.changed.length ? r.changed : undefined, note: r.changed.length ? undefined : "Nothing changed — the values were already the same." };
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
      ONLY_WHEN_ASKED +
      "Gets the business's private welcome/onboarding form link (/start/…) and ready-to-text messages in English, 简体 and 繁體 for Nora or Cameron to send. " +
      "YOU NEVER SEND IT: paste the link and messages back to the person and say they need to text it to the owner. " +
      "If a link was already made and still works, you get that same link (it's never replaced). If the owner already sent the form, read it with get_client_intake instead. " +
      "The link is private: only share it with Nora or Cameron.",
    inputSchema: { client_id: clientId },
    annotations: WRITE,
  }, async ({ client_id }) => run(async () => {
    const c = await businessLabel(client_id);
    const link = await createIntakeLink(client_id, ACTOR, { origin: ctx.baseUrl });
    const url = absUrl(ctx, link.url);
    return {
      business: c.name,
      client_id,
      url,
      reusedExistingLink: link.reused || undefined,
      messages: Object.fromEntries(INTAKE_LANG_CODES.map((code) => [INTAKE_LANG_TAG[code], INTAKE_COPY[code].share.message(c.name, url)])),
      howToSend: "Not sent. Give these to Nora or Cameron to text the owner (pick the owner's language). Nothing is sent by Nora HQ or by you.",
      teamView: absUrl(ctx, `/clients/${client_id}`),
    };
  }));

  server.registerTool("get_onboarding_status", {
    title: "Onboarding status",
    description:
      "Where a business is in onboarding: the welcome form (not sent / sent / opened / submitted / expired, with dates; whether the team has processed the answers) " +
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
    return {
      business: c.name,
      client_id,
      active: !c.archived,
      form,
      gettingStarted: steps.total
        ? { done: steps.done, total: steps.total, open: steps.tasks.filter((t) => t.status !== "done").map((t) => ({ title: t.title, for: t.assignee, status: t.status })) }
        : undefined,
      next:
        form.status === "not_sent" || form.status === "expired" || form.status === "revoked"
          ? "No working form link. If asked, get one with send_onboarding_form for a person to text."
          : form.status === "submitted"
            ? ("processed" in form && form.processed ? "Answers processed." : "Answers are in — read them with get_client_intake and work the \"Onboarding form received\" ask.")
            : "Waiting on the owner. If it's been a few days, suggest a friendly nudge (a task for Nora) — don't contact the owner yourself.",
    };
  }));
}
