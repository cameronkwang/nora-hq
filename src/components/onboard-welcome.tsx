import Link from "next/link";

/**
 * Success line on a business page right after New client (`/clients/<id>?welcome=1`).
 * Says what just happened in one line, and where Claude's research will show up.
 * Drawn as a notice: one row between two hairlines, a green dot and plain words, then the link.
 */
export function OnboardWelcome({ name, fromLead = false }: { name: string; fromLead?: boolean }) {
  return (
    <div role="status" className="notice mb-7">
      <p className="status is-ok text-text">
        <span>
          <strong className="font-semibold">{name} is set up.</strong>{" "}
          {fromLead ? "Lead marked Won. " : ""}Plan and checklist are ready. Claude is researching them now.
        </span>
      </p>
      <Link href="/asks" className="link tap-target shrink-0">
        See Claude&apos;s ask →
      </Link>
    </div>
  );
}
