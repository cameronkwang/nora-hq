import type { NotifyTopic } from "@/lib/schema";

/** Topic labels for the notification settings (shared by server and client components; no server imports). */
export const NOTIFY_TOPIC_INFO: { topic: NotifyTopic; label: string; hint: string }[] = [
  { topic: "collab_request", label: "New collab requests", hint: "A business fills in the collab form (Nora)" },
  { topic: "ask_for_me", label: "Asks for me", hint: "Something is sent or routed to you" },
  { topic: "drafts_waiting", label: "Drafts waiting", hint: "Claude wrote something to review (at most every 2 hours)" },
  { topic: "payment_overdue", label: "Payment overdue", hint: "Morning reminder when a collab payment is late (Nora)" },
  { topic: "visit_reminder", label: "Tomorrow’s schedule", hint: "Morning reminder for tomorrow’s visits and jobs, plus reels still owed on Mondays (Nora)" },
];
