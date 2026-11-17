import type { Ask, AskFor, AskKind } from "@/lib/schema";
import { Badge } from "./ui";

/**
 * "Who's it for?" — the simple choices people see, and how each maps onto asks.kind / asks.forWho.
 * Server- and client-safe (no hooks, no server-only imports).
 */
export const ASK_ROUTES = ["auto", "claude", "cameron", "nora", "idea", "fyi"] as const;
export type AskRoute = (typeof ASK_ROUTES)[number];

export const ROUTE_FIELDS: Record<AskRoute, { kind: AskKind; forWho: AskFor }> = {
  auto: { kind: "auto", forWho: "auto" },
  claude: { kind: "request", forWho: "claude" },
  cameron: { kind: "request", forWho: "cameron" },
  nora: { kind: "request", forWho: "nora" },
  idea: { kind: "idea", forWho: "anyone" },
  fyi: { kind: "update", forWho: "anyone" },
};

/**
 * People only ever pick a person: Cameron or Nora. "Cameron" is stored as auto: Claude works it in the background,
 * does what it can (drafts, research, notes) and hands the rest to Cameron. The other routes stay for older asks
 * and for Claude's own triage.
 */
export const ROUTE_LABEL: Record<AskRoute, string> = {
  auto: "Cameron",
  claude: "Claude",
  cameron: "Cameron",
  nora: "Nora",
  idea: "Just an idea",
  fyi: "FYI",
};

export function isAskRoute(v: unknown): v is AskRoute {
  return typeof v === "string" && (ASK_ROUTES as readonly string[]).includes(v);
}

/** The chips to offer: just the two people. Claude delegates in the background. */
export function routesFor(_me: string | null): AskRoute[] {
  return ["auto", "nora"];
}

/** Which chip an existing ask matches. */
export function routeOf(a: Pick<Ask, "kind" | "forWho">): AskRoute {
  // Only two chips now: anything that isn't Nora's is on Cameron's side (with Claude helping).
  return a.forWho === "nora" ? "nora" : "auto";
}

/** Small badges once an ask is sorted ("Claude", "For Cameron", "Idea", "FYI", "Question"). Nothing while unsorted. */
export function AskRouteBadges({ ask }: { ask: Pick<Ask, "kind" | "forWho"> }) {
  const out: Array<{ key: string; label: string; tone: "neutral" | "accent" | "info" | "ok" }> = [];
  if (ask.kind === "idea") out.push({ key: "k", label: "Idea", tone: "ok" });
  else if (ask.kind === "update") out.push({ key: "k", label: "FYI", tone: "neutral" });
  else if (ask.kind === "question") out.push({ key: "k", label: "Question", tone: "neutral" });
  if (ask.forWho === "claude") out.push({ key: "f", label: "Claude is on it", tone: "accent" });
  else if (ask.forWho === "cameron") out.push({ key: "f", label: "For Cameron", tone: "info" });
  else if (ask.forWho === "nora") out.push({ key: "f", label: "For Nora", tone: "info" });
  if (!out.length) return null;
  return (
    <>
      {out.map((b) => (
        <Badge key={b.key} tone={b.tone}>
          {b.label}
        </Badge>
      ))}
    </>
  );
}

/** "nora" | "cameron" for the two people (from assigneeFor(user)); null for anyone else. */
export function personKey(assignee: string): "cameron" | "nora" | null {
  return assignee === "cameron" || assignee === "nora" ? assignee : null;
}
