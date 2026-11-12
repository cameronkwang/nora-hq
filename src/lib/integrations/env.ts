import "server-only";

/** Environment checklist for Settings. Booleans only — values never leave the server. */
export type EnvVar = { name: string; group: string; required: boolean; purpose: string; doc: string };

export const ENV_VARS: EnvVar[] = [
  { name: "DATABASE_URL", group: "Core", required: true, purpose: "Neon Postgres (added by the Vercel Marketplace integration)", doc: "2. Database & storage" },
  { name: "AUTH_SECRET", group: "Core", required: true, purpose: "Signs sign-in sessions and OAuth state", doc: "3. Environment variables" },
  { name: "APP_PASSWORD", group: "Core", required: true, purpose: "Shared sign-in password", doc: "3. Environment variables" },
  { name: "APP_USERS", group: "Core", required: true, purpose: "Who can sign in (Name:email, comma separated)", doc: "3. Environment variables" },
  { name: "APP_URL", group: "Core", required: true, purpose: "Public URL, used for OAuth redirects and the connector URL", doc: "3. Environment variables" },
  { name: "TOKEN_ENC_KEY", group: "Core", required: true, purpose: "Encrypts saved Instagram/Google tokens", doc: "3. Environment variables" },
  { name: "APP_TZ", group: "Core", required: false, purpose: "Timezone for months and due dates (default America/New_York)", doc: "3. Environment variables" },
  { name: "BLOB_READ_WRITE_TOKEN", group: "Core", required: false, purpose: "Photo/video uploads (Vercel Blob) — needed for Instagram auto-publish", doc: "2. Database & storage" },
  { name: "MCP_TOKEN", group: "Claude", required: true, purpose: "Bearer token for the Claude connector", doc: "9. Claude connector" },
  { name: "CRON_SECRET", group: "Automation", required: true, purpose: "Protects the publish/sync cron endpoints", doc: "8. Scheduled jobs" },
  { name: "IG_APP_ID", group: "Instagram", required: false, purpose: "Meta app id (Instagram API with Instagram Login)", doc: "5. Instagram" },
  { name: "IG_APP_SECRET", group: "Instagram", required: false, purpose: "Meta app secret", doc: "5. Instagram" },
  { name: "GOOGLE_CLIENT_ID", group: "Google", required: false, purpose: "Google OAuth client (Business Profile + Gmail)", doc: "6. Google" },
  { name: "GOOGLE_CLIENT_SECRET", group: "Google", required: false, purpose: "Google OAuth client secret", doc: "6. Google" },
  { name: "OUTREACH_FROM_NAME", group: "Google", required: false, purpose: "Sender name on outreach emails", doc: "7. Gmail outreach" },
  { name: "OUTREACH_FOOTER", group: "Google", required: false, purpose: "Custom outreach email footer (opt-out + address)", doc: "7. Gmail outreach" },
  { name: "TIKTOK_CLIENT_KEY", group: "TikTok", required: false, purpose: "TikTok app client key (Nora's own stats)", doc: "Nora's own stats (@noraeatsgood)" },
  { name: "TIKTOK_CLIENT_SECRET", group: "TikTok", required: false, purpose: "TikTok app client secret", doc: "Nora's own stats (@noraeatsgood)" },
];

export function envStatus(): Array<EnvVar & { set: boolean }> {
  return ENV_VARS.map((v) => ({ ...v, set: !!process.env[v.name]?.trim() }));
}
