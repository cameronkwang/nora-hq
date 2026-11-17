/**
 * Nora's shoot checklist, attached to every job on her schedule. Restaurant-first: a short day-before list,
 * the on-site B-roll list (the part that matters most), and a short after list.
 * Step ids are stored on the job (schedule_items.checklist), so never rename an id — change its label instead.
 */

export type ChecklistStep = { id: string; label: string; hint?: string };
export type ChecklistSection = { key: "before" | "onsite" | "after"; title: string; note?: string; steps: ChecklistStep[] };

export const SHOOT_CHECKLIST: ChecklistSection[] = [
  {
    key: "before",
    title: "Day before",
    steps: [
      { id: "confirm", label: "Confirm the time with the owner", hint: "And what's on the house" },
      { id: "charge", label: "Charge phone, clear storage, wipe the lens" },
    ],
  },
  {
    key: "onsite",
    title: "On site: B-roll",
    note: "Get these before you sit down to eat.",
    steps: [
      { id: "ask", label: "Ask what they're known for", hint: "Order the signature dishes" },
      { id: "ok-film", label: "OK to film staff and other guests?" },
      { id: "exterior", label: "Outside: storefront and sign" },
      { id: "walk-in", label: "Walk-in: door to table" },
      { id: "vibe", label: "Room and vibe (wide shot)" },
      { id: "kitchen", label: "Kitchen action", hint: "Flames, sizzle, plating" },
      { id: "hero", label: "Hero shot of each dish" },
      { id: "money-bite", label: "The money bite", hint: "Cheese pull, dip, cut or pour" },
      { id: "close-ups", label: "Close-ups", hint: "Steam, texture, sauce" },
      { id: "drinks", label: "Drinks being made or poured" },
      { id: "menu", label: "Menu or specials board" },
      { id: "owner", label: "Owner or chef intro", hint: "Get their name and handle" },
      { id: "reaction", label: "Your first-bite reaction" },
    ],
  },
  {
    key: "after",
    title: "After",
    steps: [
      { id: "backup", label: "Back up the footage" },
      { id: "post", label: "Post it and tag them", hint: "Add the gifted or paid-partnership label" },
      { id: "thanks", label: "Send a thank-you" },
    ],
  },
];

export const CHECKLIST_STEP_IDS = new Set(SHOOT_CHECKLIST.flatMap((s) => s.steps.map((st) => st.id)));
export const CHECKLIST_TOTAL = CHECKLIST_STEP_IDS.size;

/** How many known steps are ticked (ignores ids from older versions of the list). */
export function checklistDone(ids: readonly string[] | null | undefined): number {
  return (ids ?? []).filter((id) => CHECKLIST_STEP_IDS.has(id)).length;
}
