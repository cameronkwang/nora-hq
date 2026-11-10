import "server-only";
import type { ContentPost } from "../schema";
import { notConfigured, type IntegrationResult } from "./types";

// PLACEHOLDER — replaced by the Instagram integration module.
export async function publishInstagramPost(_post: ContentPost): Promise<IntegrationResult> {
  return notConfigured("Instagram");
}
export async function replyToInstagramComment(_args: { clientId: string; commentId: string; text: string }): Promise<IntegrationResult> {
  return notConfigured("Instagram");
}
export function instagramConfigured(): boolean {
  return false;
}
