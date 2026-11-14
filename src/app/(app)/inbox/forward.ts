export type SP = Record<string, string | string[] | undefined>;

/**
 * Builds the URL a section page (/inbox, /outreach, /insights) forwards to: `?tab=` picks the member page,
 * an unknown tab and every other query param is carried over so old and shared links keep working.
 */
export function forwardTo(sp: SP, tabs: Record<string, { path: string; tab?: string }>, fallback: string): string {
  const raw = typeof sp.tab === "string" ? sp.tab : "";
  const target = tabs[raw] ?? tabs[fallback];
  const p = new URLSearchParams();
  if (target.tab) p.set("tab", target.tab);
  else if (raw && !tabs[raw]) p.set("tab", raw); // a member page's own tab (e.g. /inbox?tab=nora → /asks?tab=nora)
  for (const [k, v] of Object.entries(sp)) {
    if (k === "tab" || v === undefined) continue;
    for (const one of Array.isArray(v) ? v : [v]) p.append(k, one);
  }
  const qs = p.toString();
  return qs ? `${target.path}?${qs}` : target.path;
}
