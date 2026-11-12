import "server-only";
import { z } from "zod";
import { inArray } from "drizzle-orm";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { getDb, schema } from "@/lib/db";
import { getCreatorStats } from "@/lib/ops-creator";

/**
 * Nora's own creator stats (@noraeatsgood), read-only, so Claude can write collab pitches with real numbers.
 * Wire with registerCreatorTools(server) in server.ts.
 */

function compactJson(data: unknown): string {
  return JSON.stringify(data, (_k, v) => (v === null || v === undefined ? undefined : v));
}

async function run(fn: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return { content: [{ type: "text", text: compactJson(await fn()) }] };
  } catch (e) {
    if (!(e instanceof z.ZodError)) console.error("[mcp] creator tool error", e);
    return { content: [{ type: "text", text: `Couldn't read Nora's stats: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
  }
}

const READ = { readOnlyHint: true, openWorldHint: false } as const;

export function registerCreatorTools(server: McpServer) {
  server.registerTool("get_creator_stats", {
    title: "Get Nora's creator stats",
    description:
      "Nora's own @noraeatsgood numbers on Instagram and TikTok: followers and growth, views over ~28 days, engagement rate, " +
      "average views per reel/video, top posts of the last 30 days (with any business they were a collab for), Instagram audience " +
      "(top cities, ages) and a ready media-kit summary. Use these exact numbers in collab pitches and media kits — never round up or invent. " +
      "Numbers marked null are unknown; leave them out rather than guessing.",
    inputSchema: {
      days: z.number().int().min(7).max(365).default(90).describe("How many days of daily follower history to include."),
    },
    annotations: READ,
  }, async ({ days }) => run(async () => {
    const s = await getCreatorStats({ days });
    const clientIds = [...new Set(s.topPosts.map((p) => p.clientId).filter((x): x is string => !!x))];
    const names = new Map<string, string>();
    if (clientIds.length) {
      const db = await getDb();
      for (const c of await db.select({ id: schema.clients.id, name: schema.clients.name }).from(schema.clients).where(inArray(schema.clients.id, clientIds))) names.set(c.id, c.name);
    }
    const platform = (p: (typeof s.platforms)["instagram"]) => ({
      connected: p.connected,
      account: p.connectionLabel,
      followers: p.followers,
      followersAsOf: p.followersDate,
      followerChange7d: p.change7,
      followerChange30d: p.change30,
      views28d: p.views28,
      views28dNote: p.viewsNote,
      engagementRatePct: p.engagementRate != null ? Math.round(p.engagementRate * 1000) / 10 : null,
      avgViewsLast10Videos: p.avgViewsLast10,
      postsThisMonth: p.postsThisMonth,
      lastSyncedAt: p.lastSyncedAt?.toISOString(),
    });
    // Thin the history to at most ~60 points so it stays cheap to read.
    const thin = (pts: Array<{ date: string; followers: number }>) => {
      const step = Math.max(1, Math.ceil(pts.length / 60));
      return pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
    };
    return {
      handle: "@noraeatsgood",
      today: s.today,
      instagram: platform(s.platforms.instagram),
      tiktok: platform(s.platforms.tiktok),
      followerHistory: { instagram: thin(s.series.instagram), tiktok: thin(s.series.tiktok) },
      topPostsLast30Days: s.topPosts.map((p) => ({
        platform: p.platform,
        type: p.mediaType,
        postedAt: p.postedAt?.toISOString().slice(0, 10),
        caption: p.caption ? p.caption.slice(0, 160) : null,
        url: p.permalink,
        views: p.views, likes: p.likes, comments: p.comments, shares: p.shares, saves: p.saves,
        collabFor: p.clientId ? names.get(p.clientId) ?? p.clientId : null,
      })),
      audience: s.audience ? {
        platform: "instagram",
        capturedAt: s.audience.capturedAt.toISOString().slice(0, 10),
        topCities: s.audience.cities,
        ages: s.audience.ages,
        genders: s.audience.genders,
      } : null,
      mediaKit: s.mediaKit,
    };
  }));
}
