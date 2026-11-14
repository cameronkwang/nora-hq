import "server-only";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OpsError } from "@/lib/ops";
import { currentMonth, isMonth } from "@/lib/dates";
import { importSchedule, listSchedule, reelsToPost, type ScheduleRow } from "@/lib/ops-schedule";

/**
 * Nora's schedule tools: which businesses she's working with each month (day or "no set day"), free or
 * not, and reels (📸) she still has to post. Claude can read it and add/update items (actor "claude");
 * removing items and ticking reels as posted are for Nora/Cameron in the app. No money, ever.
 */

const ACTOR = "claude";

function compactJson(data: unknown): string {
  return JSON.stringify(data, (_k, v) => (v === null || v === undefined ? undefined : v));
}

function errorMessage(e: unknown): string {
  if (e instanceof z.ZodError) return `Invalid input — ${e.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ")}`;
  if (e instanceof OpsError) return e.message;
  console.error("[mcp] schedule tool error", e);
  return `Something went wrong in Nora HQ: ${e instanceof Error ? e.message : String(e)}`;
}

async function run(fn: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return { content: [{ type: "text", text: compactJson(await fn()) }] };
  } catch (e) {
    return { content: [{ type: "text", text: errorMessage(e) }], isError: true };
  }
}

const READ = { readOnlyHint: true, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

const shape = (r: ScheduleRow) => ({
  id: r.id,
  month: r.month,
  date: r.date ?? "no set day",
  business: r.businessName,
  clientId: r.clientId,
  clientName: r.clientName,
  free: r.isFree || undefined,
  reel: r.needsReel ? (r.reelPostedAt ? `posted ${r.reelPostedAt.toISOString().slice(0, 10)}` : "to post") : undefined,
});

export function registerScheduleTools(server: McpServer) {
  server.registerTool("list_schedule", {
    title: "List Nora's schedule",
    description:
      "Nora's jobs for one month (default: this month): business, day (or \"no set day\"), free, and reel status " +
      "(\"to post\" = she still owes a reel). Linked businesses carry clientId. The schedule never includes money — don't ask for or add amounts.",
    inputSchema: { month: z.string().optional().describe("YYYY-MM, e.g. \"2026-11\". Defaults to the current month (Eastern).") },
    annotations: READ,
  }, async ({ month }) => run(async () => {
    if (month && !isMonth(month)) throw new OpsError(`Month should look like 2026-11, got "${month}".`);
    const m = month || currentMonth();
    const rows = await listSchedule(m);
    return { month: m, count: rows.length, reelsToPost: rows.filter((r) => r.needsReel && !r.reelPostedAt).length, items: rows.map(shape) };
  }));

  server.registerTool("add_to_schedule", {
    title: "Add to Nora's schedule",
    description:
      "Add or update jobs on Nora's schedule. Pass either raw_text (her list as she writes it, e.g. \"11/04 | Antonelli’s - FREE 📸\", " +
      "\"11/XX | Bloom\" for no set day; amounts and 🚩 are ignored) or items[]. Re-adding is safe: items match by month + business name, " +
      "a newly known date fills in \"no set day\", 📸 is only ever added, Free follows the latest paste (in items[], leaving free out keeps it as it is). Set dry_run to preview first. " +
      "You can't remove items or mark reels posted — Nora or Cameron do that in the app. Never include money.",
    inputSchema: {
      raw_text: z.string().max(50_000).optional().describe("Nora's list pasted as-is. One job per line: MM/DD | Business [- FREE] [📸]."),
      items: z
        .array(
          z.object({
            business: z.string().min(1).max(200),
            date: z.string().optional().describe("YYYY-MM-DD. Leave out when there's no set day (then give month)."),
            month: z.string().optional().describe("YYYY-MM — needed only without a date."),
            free: z.boolean().optional().describe("Leave out to keep an existing item's Free as it is (new items: not free)."),
            reel: z.boolean().optional().describe("true = Nora owes a reel (📸)."),
          }),
        )
        .max(300)
        .optional(),
      dry_run: z.boolean().default(false),
    },
    annotations: WRITE,
  }, async (a) => run(async () => {
    if (!a.raw_text?.trim() && !a.items?.length) throw new OpsError("Pass raw_text or items.");
    if (a.raw_text?.trim() && a.items?.length) throw new OpsError("Pass raw_text or items, not both.");
    const input = a.raw_text?.trim()
      ? a.raw_text
      : a.items!.map((i) => ({ businessName: i.business, date: i.date || null, month: i.month || null, isFree: i.free, needsReel: i.reel }));
    const r = await importSchedule(input, ACTOR, { dryRun: a.dry_run });
    return {
      dryRun: r.dryRun,
      added: r.add,
      updated: r.update,
      unchanged: r.unchanged,
      changes: r.rows.filter((x) => x.action !== "unchanged").map((x) => ({
        action: x.action, month: x.month, date: x.date ?? "no set day", business: x.businessName, linkedTo: x.clientName, changes: x.changes.length ? x.changes : undefined,
      })),
      skipped: r.skipped.length ? r.skipped : undefined,
    };
  }));

  server.registerTool("get_reels_to_post", {
    title: "Reels Nora still owes",
    description: "Every schedule item marked 📸 whose reel isn't posted yet, oldest first, across all months. Use for reminders and when planning content.",
    inputSchema: {},
    annotations: READ,
  }, async () => run(async () => {
    const rows = await reelsToPost();
    return { count: rows.length, reels: rows.map(shape) };
  }));
}
