import { routeAskAction } from "@/app/(app)/asks/actions";
import type { Ask } from "@/lib/schema";
import { ROUTE_LABEL, routeOf, type AskRoute } from "./ask-route";

/**
 * Compact "Who's it for?" chips on an ask's page. Each chip is its own tiny form (works without JS);
 * the current route is the ink one. Routing a request to a person puts a task on their list.
 */
export function AskRoutePicker({ ask, routes }: { ask: Pick<Ask, "id" | "kind" | "forWho">; routes: AskRoute[] }) {
  const current = routeOf(ask);
  // Keep the current route visible even if it isn't one of this person's usual chips (e.g. "Nora" for Nora).
  const shown = routes.includes(current) ? routes : [...routes, current];
  return (
    <div role="group" aria-label="Who's it for?" className="chips">
      {shown.map((r) => {
        const on = r === current;
        return (
          <form key={r} action={routeAskAction}>
            <input type="hidden" name="id" value={ask.id} />
            <input type="hidden" name="route" value={r} />
            <button type="submit" aria-pressed={on} disabled={on} className={on ? "chip cursor-default" : "chip"}>
              <span>{ROUTE_LABEL[r]}</span>
            </button>
          </form>
        );
      })}
    </div>
  );
}
