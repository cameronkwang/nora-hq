import "server-only";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { schema } from "@/lib/db";
import { OpsError } from "@/lib/ops";
import { triageAsk } from "@/lib/ops-asks";
import { clientNames } from "./queries";

/**
 * Ask triage tools for the Nora HQ connector. Same conventions as tools.ts: every write goes through
 * lib/ops*.ts with actor "claude"; descriptions are Claude's instructions.
 * Wired in by the integrator: call registerAskTools(server) next to registerTools(server, ctx).
 */

const ACTOR = "claude";

class ToolError extends Error {}

/** JSON without nulls/undefined to keep responses compact. */
function compactJson(data: unknown): string {
  return JSON.stringify(data, (_k, v) => (v === null || v === undefined ? undefined : v));
}

function errorMessage(e: unknown): string {
  if (e instanceof z.ZodError) return `Invalid input — ${e.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ")}`;
  if (e instanceof ToolError || e instanceof OpsError) return e.message;
  console.error("[mcp] tool error", e);
  return `Something went wrong in Nora HQ: ${e instanceof Error ? e.message : String(e)}`;
}

async function run(fn: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    const data = await fn();
    return { content: [{ type: "text", text: compactJson(data) }] };
  } catch (e) {
    return { content: [{ type: "text", text: errorMessage(e) }], isError: true };
  }
}

const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

const NEXT_STEP: Record<string, string> = {
  "request:claude": "It's yours — do the work now (drafts linked with ask_id), then update_ask with status done and a short note.",
  "request:cameron": "Routed to Cameron; a task is on his list. Leave the ask's status alone — it closes when he marks the task done.",
  "request:nora": "Routed to Nora; a task is on her list. Leave the ask's status alone — it closes when she marks the task done.",
  idea: "Kept in Ideas. Optionally reply_to_ask with one short, useful thought, then update_ask status done.",
  update: "Apply the FYI (e.g. a task or note on the business), then update_ask status done with a note saying what you recorded.",
  question: "Answer it with reply_to_ask, then update_ask status done.",
};

export function registerAskTools(server: McpServer) {
  server.registerTool("triage_ask", {
    title: "Triage an ask",
    description:
      "Sort an ask: what it is (kind) and who should act on it (for_who). Asks are anything Nora or Cameron drop in, so TRIAGE EVERY UNTRIAGED ASK FIRST " +
      "(get_briefing lists them first with untriaged: true) — this is what files it in the right place in the app. Then act on it:\n" +
      "- request + for_who claude → do it yourself now.\n" +
      "- request + for_who cameron / nora → only a person can do it (passwords, filming, calls, in-person visits, money). A task is created on their list automatically " +
      "(once — re-running is safe). Don't do it yourself and leave the ask's status alone; it closes when they finish the task.\n" +
      "- idea (for_who anyone) → keep it; optionally reply_to_ask with one short, useful thought, then mark the ask done.\n" +
      "- update (an FYI, for_who anyone) → apply it (e.g. \"Max's closed Monday\" becomes a task or note for that business), then mark the ask done with a note saying what you recorded.\n" +
      "- question → answer it in the thread (reply_to_ask), then mark it done.\n" +
      "If Nora or Cameron already set kind/for_who, keep their choice unless it's clearly wrong. Set client_id when you can tell which business it's about. " +
      "`note` (optional) is a one-line summary shown at the top of the ask, e.g. \"Routed to Cameron — it's on his task list\"; it replaces any earlier note.",
    inputSchema: {
      ask_id: z.string(),
      kind: z.enum(schema.ASK_KINDS.filter((k) => k !== "auto") as ["request", "idea", "update", "question"])
        .describe("request = something to do · idea = a suggestion to keep · update = an FYI to apply · question = something to answer."),
      for_who: z.enum(schema.ASK_FOR.filter((k) => k !== "auto") as ["claude", "cameron", "nora", "anyone"])
        .describe("claude = you do it · cameron / nora = that person does it (a task is created for requests) · anyone = no single owner (ideas, FYIs)."),
      client_id: z.string().optional().describe("Business id from list_clients, if the ask is about one business."),
      note: z.string().max(4000).optional().describe("Optional one-line summary shown to Nora at the top of the ask. Replaces the previous note."),
    },
    annotations: { ...WRITE, idempotentHint: true },
  }, async ({ ask_id, kind, for_who, client_id, note }) => run(async () => {
    const { ask, taskId } = await triageAsk(ask_id, { kind, forWho: for_who, clientId: client_id, note }, ACTOR);
    const names = await clientNames();
    return {
      ok: true,
      ask: { id: ask.id, status: ask.status, kind: ask.kind, forWho: ask.forWho, businessId: ask.clientId, business: ask.clientId ? names.get(ask.clientId) : null },
      ...(taskId ? { taskCreated: taskId } : {}),
      next: NEXT_STEP[`${kind}:${for_who}`] ?? NEXT_STEP[kind] ?? "Carry on with the ask.",
    };
  }));
}
