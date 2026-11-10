import { randomBytes } from "node:crypto";

/** Short, sortable-enough ids: base36 time prefix + random suffix. */
export function newId(prefix = ""): string {
  const t = Date.now().toString(36);
  const r = randomBytes(6).toString("base64url");
  return `${prefix}${t}${r}`;
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
