export type IntegrationResult =
  | { ok: true; externalId?: string; permalink?: string; threadId?: string }
  | { ok: false; error: string; notConfigured?: boolean };

export const notConfigured = (what: string): IntegrationResult => ({ ok: false, notConfigured: true, error: `${what} is not connected yet (Settings → Connections).` });
