import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getScheduleItem } from "@/lib/ops-schedule";
import { SHOOT_CHECKLIST } from "@/lib/shoot-checklist";
import { ShootChecklist } from "@/components/shoot-checklist";
import { ReelPostedButton } from "@/components/reel-posted-button";
import { LinkButton, PageHeader, Status, Tag } from "@/components/ui";

export const dynamic = "force-dynamic";

const dayLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
const monthName = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

/**
 * One job on Nora's schedule, built for the phone she's holding on site: when it is, links to the business
 * and deal, and the shoot checklist (day before, B-roll on site, after) as big tap rows. Never an amount.
 * Ink: the serif title, the day and the job's facts on one muted line, quiet buttons to the deal and the business,
 * the one focal action (Reel posted, ink), then the checklist as sections on hairlines.
 */
export default async function ScheduleJobPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const job = await getScheduleItem(id);
  if (!job) notFound();
  const owesReel = job.needsReel && !job.reelPostedAt;

  return (
    <div className="job-page">
      <PageHeader
        crumb={<Link href={`/calendar?month=${job.month}`}>Schedule</Link>}
        title={job.businessName}
        subtitle={
          <span className="job-facts">
            <span className="text-text">{job.date ? dayLabel(job.date) : `Sometime in ${monthName(job.month)}`}</span>
            {job.isFree && <Tag bare>Free</Tag>}
            {owesReel && (
              <Status tone="warn" small>
                <span className="emoji" aria-hidden>📸</span> Reel to post
              </Status>
            )}
            {job.needsReel && job.reelPostedAt && (
              <Status tone="ok" small>
                Reel posted
              </Status>
            )}
          </span>
        }
      />

      {(job.dealId || job.clientId) && (
        <div className="job-links">
          {job.dealId && <LinkButton href={`/deals/${job.dealId}/visit`}>Visit mode</LinkButton>}
          {job.dealId && <LinkButton href={`/deals/${job.dealId}`}>Deal</LinkButton>}
          {job.clientId && <LinkButton href={`/clients/${job.clientId}`}>{job.clientName ?? "Business"}</LinkButton>}
        </div>
      )}

      {job.needsReel && (
        <div className="job-reel">
          <ReelPostedButton id={job.id} posted={!!job.reelPostedAt} />
        </div>
      )}

      <ShootChecklist jobId={job.id} sections={SHOOT_CHECKLIST} initialDone={job.checklist} />
    </div>
  );
}
