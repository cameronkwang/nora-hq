import "server-only";
import { allowedUsers } from "@/lib/auth";

/** "claude" → "Claude", a signed-in user's email → their first name, anything else as-is. */
export function actorName(actor: string | null | undefined): string {
  if (!actor) return "Someone";
  if (actor.toLowerCase() === "claude") return "Claude";
  const u = allowedUsers().find((x) => x.email === actor.toLowerCase());
  if (u) return u.name;
  if (actor === "system" || actor === "cron") return "Automation";
  return actor.includes("@") ? actor.split("@")[0] : actor;
}

/** Where an activity row should link, for entity types whose pages exist. */
export function entityHref(entityType: string, entityId: string, clientId: string | null): string | null {
  switch (entityType) {
    case "task":
      return `/tasks/${entityId}`;
    case "ask":
      return `/asks/${entityId}`;
    case "client":
      return `/clients/${entityId}`;
    case "draft":
      return `/review?draft=${entityId}`;
    default:
      return clientId ? `/clients/${clientId}` : null;
  }
}
