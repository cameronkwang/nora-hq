import "server-only";
import { notConfigured, type IntegrationResult } from "./types";

// PLACEHOLDER — replaced by the Gmail integration module.
export async function sendOutreachEmail(_args: { to: string; subject: string; body: string; threadId?: string | null }): Promise<IntegrationResult> {
  return notConfigured("Gmail");
}
export function gmailConfigured(): boolean {
  return false;
}
