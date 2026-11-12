import "server-only";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OpsError } from "@/lib/ops";
import { createSavedReply, listSavedReplies } from "@/lib/ops-replies";
import { REPLY_CATEGORIES } from "@/components/reply-fill";

/**
 * Saved replies for Claude: read the library (to match Nora's voice / reuse wording in drafts) and suggest new ones.
 * Claude can't edit, delete, keep or use replies — a suggestion waits on /replies until Nora or Cameron keeps or discards it.
 * Wired in by the integrator: call registerReplyTools(server) next to the other register* calls.
 */

function compactJson(data: unknown): string {
  return JSON.stringify(data, (_k, v) => (v === null || v === undefined || v === "" ? undefined : v));
}

function errorMessage(e: unknown): string {
  if (e instanceof z.ZodError) return `Invalid input — ${e.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ")}`;
  if (e instanceof OpsError) return e.message;
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

export function registerReplyTools(server: McpServer) {
  server.registerTool("list_saved_replies", {
    title: "List saved replies",
    description:
      "Nora's saved reply templates (her voice, her wording — reuse it in drafts). Placeholders {name} {business} {date} {link} are filled in by the app when a person picks one. " +
      "Includes your own pending suggestions (status \"suggested\").",
    inputSchema: {
      category: z.enum(REPLY_CATEGORIES).optional().describe("Only this category."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ category }) => run(async () => {
    const rows = await listSavedReplies("all");
    return {
      replies: rows
        .filter((r) => !category || r.category === category)
        .map((r) => ({ id: r.id, title: r.title, category: r.category, status: r.status, uses: r.useCount, body: r.body })),
    };
  }));

  server.registerTool("suggest_reply", {
    title: "Suggest a saved reply",
    description:
      "Suggest a new saved reply template when you notice Nora or Cameron sending the same kind of message repeatedly. " +
      "It is saved as \"suggested\" and does nothing until a person keeps it on the Saved replies page. " +
      "Write it as Nora, first person: warm, concise, specific. Use only these placeholders: {name} {business} {date} {link}. " +
      "Collab rates: paid collabs start at $600 and custom packages are available if they reach out to Nora directly — don't quote other prices. " +
      "Never ask for or suggest Google/Yelp reviews in exchange for anything, and keep FTC disclosure wording intact. " +
      "Don't suggest a title that already exists (check list_saved_replies).",
    inputSchema: {
      title: z.string().min(1).max(120).describe("Short label shown in the picker, e.g. \"Reschedule visit\"."),
      body: z.string().min(1).max(4000).describe("The reply text, with placeholders."),
      category: z.enum(REPLY_CATEGORIES).describe("collab · client · outreach · general"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ title, body, category }) => run(async () => {
    const id = await createSavedReply({ title, body, category }, "claude");
    return { id, status: "suggested", note: "Saved as a suggestion. Nora or Cameron will keep or discard it on the Saved replies page." };
  }));
}
