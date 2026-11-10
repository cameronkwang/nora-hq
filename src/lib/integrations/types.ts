import type { IgContainer } from "../schema";

export type IntegrationResult =
  | { ok: true; externalId?: string; permalink?: string; threadId?: string }
  | { ok: false; error: string; notConfigured?: boolean; /** Instagram container still processing; retry with it later. */ pendingContainer?: IgContainer };

export const notConfigured = (what: string): IntegrationResult => ({ ok: false, notConfigured: true, error: `${what} is not connected yet (Settings → Connections).` });
