import "server-only";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OpsError } from "@/lib/ops";
import { buildReportMetrics, createReport } from "@/lib/ops-reports";
import { isMonth, monthLabel } from "@/lib/dates";

/**
 * Monthly client reports. Claude reads the numbers and writes both reports as drafts; a person approves the
 * external one in Review and sends it to the owner. There is deliberately no tool to approve, send or mark a
 * report sent. Wired in by the integrator: call registerReportTools(server) next to the other register* calls.
 */

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

const MonthArg = z.string().refine(isMonth, "Use YYYY-MM").describe("Report month, YYYY-MM (usually last month).");

const NEVER_MIX = "Never put internal metrics in the external report.";

const EXTERNAL_GUIDE =
  "EXTERNAL report (the business owner reads it): friendly, concise, plain words, written from Nora & Cameron's team. " +
  "Lead with wins. Give numbers with context (vs last month, what it means) — only numbers from external metrics, never invented. " +
  "Suggested shape: a one-line summary, ## Highlights (3–5 bullets), ## The numbers (posts published, views/reach/followers with month-over-month), " +
  "## Google reviews (received, replied, average rating), ## Creator collabs (if any), ## Next month (1–3 focus points — replace the placeholder). " +
  "No internal jargon, no effort/hours, no task counts, revision rates, approvals, blockers, issues or anything from `internal`. Missing numbers: leave that line out rather than saying 'no data'.";

const INTERNAL_GUIDE =
  "INTERNAL report (Cameron & Nora only): candid and short. Cover plan completion per deliverable (what was missed and why if known), " +
  "ad hoc tasks done/open/overdue, drafts approved vs sent back (revision rate) and time-to-approve, unreplied reviews, outreach pipeline by stage, " +
  "open asks, issues/blockers — then ## Next actions (owner + concrete step). It may use both external and internal metrics.";

export function registerReportTools(server: McpServer) {
  server.registerTool("get_report_metrics", {
    title: "Get report metrics",
    description:
      `The numbers for one business's monthly reports, split in two: \`external\` (safe for the owner) and \`internal\` (team only). ${NEVER_MIX} ` +
      "Call this before create_report. Numbers come from what Nora HQ has recorded; nextMonthFocus is a placeholder for you to replace.",
    inputSchema: { client_id: z.string().describe("Business id (from list_clients). Not Nora's own workspace."), month: MonthArg },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ client_id, month }) => run(async () => {
    const m = await buildReportMetrics(client_id, month);
    return {
      business: m.client.name,
      month: m.month,
      monthLabel: monthLabel(m.month),
      note: `${NEVER_MIX} \`external\` may appear in the owner's report; \`internal\` only in the internal one.`,
      external: m.external,
      internal: m.internal,
      next: "Write both reports with create_report (audience internal, then external).",
    };
  }));

  server.registerTool("create_report", {
    title: "Create a monthly report",
    description:
      "Saves one monthly report for a business as a DRAFT (re-running it for the same month + audience revises the draft). " +
      "The external one is also filed in Review for Nora or Cameron to approve; approving never sends it — a person sends it to the owner. " +
      `You can't approve or send reports. ${NEVER_MIX}\n\n${EXTERNAL_GUIDE}\n\n${INTERNAL_GUIDE}\n\n` +
      "Format: Markdown — # title, ## sections, - bullets, **bold**, [links](https://…). No tables, no HTML, no images.",
    inputSchema: {
      client_id: z.string().describe("Business id."),
      month: MonthArg,
      audience: z.enum(["internal", "external"]).describe("internal = team only; external = owner-facing (goes to Review)."),
      body_markdown: z.string().min(20).max(20_000).describe("The full report in Markdown."),
      ask_id: z.string().optional().describe("The ask that asked for this report, if any (for your own update_ask afterwards)."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ client_id, month, audience, body_markdown, ask_id }) => run(async () => {
    const r = await createReport({ clientId: client_id, month, audience, body: body_markdown }, "claude");
    return {
      reportId: r.id,
      status: r.status,
      audience: r.audience,
      draftId: r.draftId,
      next: audience === "external"
        ? `Filed in Review for approval. A person sends it to the owner afterwards — don't say it was sent.${ask_id ? ` Then update_ask ${ask_id}.` : ""}`
        : `Saved for the team (Reports page).${ask_id ? ` Then update_ask ${ask_id}.` : ""}`,
    };
  }));
}
