import "server-only";
import type { Review } from "../schema";
import { notConfigured, type IntegrationResult } from "./types";

// PLACEHOLDER — replaced by the Google Business Profile integration module.
export async function replyToGoogleReview(_review: Review, _text: string): Promise<IntegrationResult> {
  return notConfigured("Google Business Profile");
}
export function googleConfigured(): boolean {
  return false;
}
