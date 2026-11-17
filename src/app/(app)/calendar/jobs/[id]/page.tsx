import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getScheduleItem } from "@/lib/ops-schedule";
import { SHOOT_CHECKLIST } from "@/lib/shoot-checklist";
import { ShootChecklist } from "@/components/shoot-checklist";
import { ReelPostedButton } from "@/components/reel-posted-button";
import { Badge, LinkButton } from "@/components/ui";

export const dynamic = "force-dynamic";

const dayLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
const monthName = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

/**
 * One job on Nora's schedule, built for the phone she's holding on site: when it is, links to the business
 * and deal, and the shoot checklist (day before, B-roll on site, after) as big tap rows.
 */
export default async function ScheduleJobPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const job = await getScheduleItem(id);
  if (!job) notFound();
  const owesReel = job.needsReel && !job.reelPostedAt;

  return (
    <div className="mx-auto max-w-xl">
      <p className="mb-3 text-sm">
        <Link href={`/calendar?month=${job.month}`} className="inline-flex min-h-11 items-center text-muted hover:underline md:min-h-0">
          ← Schedule
        </Link>
      </p>

      <header className="mb-4">
        <h1 className="text-3xl font-semibold leading-tight tracking-tight break-words">{job.businessName}</h1>
        <p className="mt-1 text-lg text-muted">{job.date ? dayLabel(job.date) : `Sometime in ${monthName(job.month)}`}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {job.isFree && <Badge tone="ok">Free</Badge>}
          {owesReel && <Badge tone="warn">📸 Reel to post</Badge>}
          {job.needsReel && job.reelPostedAt && <Badge tone="ok">Reel posted</Badge>}
        </div>
      </header>

      {(job.dealId || job.clientId) && (
        <div className="mb-5 flex flex-wrap gap-2">
          {job.dealId && (
            <LinkButton href={`/deals/${job.dealId}/visit`} variant="primary">
              Visit mode
            </LinkButton>
          )}
          {job.dealId && <LinkButton href={`/deals/${job.dealId}`}>Deal</LinkButton>}
          {job.clientId && <LinkButton href={`/clients/${job.clientId}`}>{job.clientName ?? "Business"}</LinkButton>}
        </div>
      )}

      {job.needsReel && (
        <div className="mb-5">
          <ReelPostedButton id={job.id} posted={!!job.reelPostedAt} />
        </div>
      )}

      <ShootChecklist jobId={job.id} sections={SHOOT_CHECKLIST} initialDone={job.checklist} />
    </div>
  );
}
