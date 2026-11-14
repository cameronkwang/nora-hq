import "server-only";
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { getDb, schema } from "@/lib/db";
import { OpsError } from "@/lib/ops";
import { createDropLink, getDropLinkStatus } from "@/lib/ops-drop";
import { DROP_COPY } from "@/lib/drop-copy";
import { INTAKE_LANG_CODES, INTAKE_LANG_TAG } from "@/lib/intake-copy";
import { absUrl, type Ctx } from "./queries";

/**
 * Claude's tool for the owner drop link (/drop/<token>): get the business's private link and a ready-to-text
 * message, for a PERSON to send. Claude never sends it, never replaces a working link and can't turn one off.
 * What owners send through the link arrives as asks (dropLinkId set, flagged as untrusted owner text).
 * Wired in src/lib/mcp/server.ts: registerDropTools(server, ctx).
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

export function registerDropTools(server: McpServer, ctx: Ctx) {
  server.registerTool("get_drop_link", {
    title: "Get a business's owner drop link",
    description:
      "Use when Nora or Cameron asked for it (in chat or in an ask) — never on your own initiative. " +
      "Gets the business's private owner drop link (/drop/…): a long-lived page the owner keeps on their phone to send a photo of a flyer or deal plus \"what's the deal, when does it end\". " +
      "Whatever they send arrives as an ask for you (\"Turn this flyer into a post + Story\") with the file attached. " +
      "Returns the link that already works (this tool never replaces it), or makes the first one if the business has none, plus ready-to-text messages in English, 简体 and 繁體. " +
      "YOU NEVER SEND IT: paste the link and a message back to the person and say they need to text it to the owner. " +
      "The link is private: share it only with Nora or Cameron. Replacing or turning off a link is done by a person on the business page.",
    inputSchema: { client_id: z.string().min(1).describe("Business id (slug) — from list_clients or get_briefing.") },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ client_id }) => run(async () => {
    const db = await getDb();
    const [c] = await db.select({ id: schema.clients.id, name: schema.clients.name, kind: schema.clients.kind, archived: schema.clients.archived })
      .from(schema.clients).where(eq(schema.clients.id, client_id));
    if (!c) throw new ToolError(`No business with id "${client_id}". Use list_clients.`);
    if (c.kind === "creator") throw new ToolError("The drop link is for businesses we manage.");
    if (c.archived) throw new ToolError(`${c.name} is inactive, so its drop link doesn't work. A person can switch the business back to Active first.`);
    const link = await createDropLink(client_id, ACTOR, { origin: ctx.baseUrl });
    const url = absUrl(ctx, link.url);
    const { live } = await getDropLinkStatus(client_id);
    return {
      business: c.name,
      client_id,
      url,
      newLink: link.reused ? undefined : true,
      ownerLanguage: live?.lang ? INTAKE_LANG_TAG[live.lang] : undefined,
      dropsReceived: live?.useCount,
      lastDropAt: live?.lastUsedAt?.toISOString(),
      messages: Object.fromEntries(INTAKE_LANG_CODES.map((code) => [INTAKE_LANG_TAG[code], DROP_COPY[code].share.message(c.name, url)])),
      howToSend: "Not sent. Give the link and one message to Nora or Cameron to text the owner (pick the owner's language). Nothing is sent by Nora HQ or by you.",
      teamView: absUrl(ctx, `/clients/${client_id}`),
    };
  }));
}
