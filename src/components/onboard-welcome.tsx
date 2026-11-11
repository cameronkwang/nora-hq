import Link from "next/link";

/**
 * Success banner on a business page right after New client (`/clients/<id>?welcome=1`).
 * Says what just happened in one line, and where Claude's research will show up.
 */
export function OnboardWelcome({ name, fromLead = false }: { name: string; fromLead?: boolean }) {
  return (
    <div role="status" className="mb-5 flex flex-col gap-2 rounded-xl bg-ok-soft px-4 py-3 text-sm text-ok sm:flex-row sm:items-center sm:justify-between">
      <p>
        <span aria-hidden>✓ </span>
        <strong className="font-semibold">{name} is set up.</strong>{" "}
        {fromLead ? "Lead marked Won. " : ""}Plan and checklist are ready — Claude is researching them now.
      </p>
      <Link href="/asks" className="inline-flex min-h-11 shrink-0 items-center font-medium underline-offset-2 hover:underline md:min-h-0">
        See Claude&apos;s ask →
      </Link>
    </div>
  );
}
