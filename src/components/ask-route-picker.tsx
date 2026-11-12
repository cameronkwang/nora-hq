import { routeAskAction } from "@/app/(app)/asks/actions";
import type { Ask } from "@/lib/schema";
import { ROUTE_LABEL, routeOf, type AskRoute } from "./ask-route";
import { cx } from "./ui";

/**
 * Compact "Who's it for?" chips on an ask's page. Each chip is its own tiny form (works without JS);
 * the current route is highlighted. Routing a request to a person puts a task on their list.
 */
export function AskRoutePicker({ ask, routes }: { ask: Pick<Ask, "id" | "kind" | "forWho">; routes: AskRoute[] }) {
  const current = routeOf(ask);
  // Keep the current route visible even if it isn't one of this person's usual chips (e.g. "Nora" for Nora).
  const shown = routes.includes(current) ? routes : [...routes, current];
  return (
    <div role="group" aria-label="Who's it for?" className="flex flex-wrap gap-2">
      {shown.map((r) => {
        const on = r === current;
        return (
          <form key={r} action={routeAskAction}>
            <input type="hidden" name="id" value={ask.id} />
            <input type="hidden" name="route" value={r} />
            <button
              type="submit"
              aria-pressed={on}
              disabled={on}
              className={cx(
                "inline-flex min-h-8 items-center rounded-full border px-3 text-xs font-medium transition pointer-coarse:min-h-11 pointer-coarse:text-sm",
                on ? "border-accent bg-accent-soft text-accent" : "border-border bg-surface text-muted hover:text-text",
              )}
            >
              {ROUTE_LABEL[r]}
            </button>
          </form>
        );
      })}
    </div>
  );
}
