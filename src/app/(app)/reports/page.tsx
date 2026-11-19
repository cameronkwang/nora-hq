import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getClient, isCreatorClient, listBusinesses } from "@/lib/data";
import { formatDate, isMonth, monthLabel } from "@/lib/dates";
import { listClientReports, reportMonths, type ReportRow } from "@/lib/ops-reports";
import { EmptyState, LinkButton, PageHeader, Status, Tag, clientLabel, cx } from "@/components/ui";
import { CopyButton } from "@/components/copy-button";
import { ReportMarkdown, markdownToPlainText } from "@/components/report-markdown";
import { ReportRequestButton, ReportSendActions } from "@/components/report-actions";
import { markReportSentAction, requestReportAction, sendReportAction } from "./actions";

/**
 * /reports?client=<id>[&month=YYYY-MM][&tab=internal|external] — a business's monthly reports.
 * No nav item: linked from each business page. Internal = team only; external = what the owner receives,
 * and only after a person approves it in Review and sends it from here.
 */

export const dynamic = "force-dynamic";
export const metadata = { title: "Reports" };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

function statusChip(r: ReportRow | undefined) {
  if (!r) return <Status small>Not started</Status>;
  if (r.audience === "internal") return <Tag bare>Team only</Tag>;
  if (r.status === "sent") return <Status tone="ok" small>Sent</Status>;
  if (r.status === "approved") return <Status tone="ink" small>Approved · not sent</Status>;
  if (r.draftStatus === "rejected") return <Status small>Sent back</Status>;
  return <Status tone="warn" small>Needs review</Status>;
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireUser();
  const sp = await searchParams;
  const clientId = one(sp.client);

  if (!clientId) {
    const businesses = await listBusinesses();
    return (
      <>
        <PageHeader title="Reports" subtitle="Monthly reports per business. Pick one." />
        {businesses.length === 0 ? (
          <EmptyState title="No businesses yet" />
        ) : (
          <ul className="list is-ruled max-w-3xl">
            {businesses.map((b) => (
              <li key={b.id}>
                <Link href={`/reports?client=${encodeURIComponent(b.id)}`} className="row">
                  <span className="row-title">{clientLabel(b)}</span>
                  <svg viewBox="0 0 16 16" aria-hidden className="chev size-3.5" fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M6 3.5 10.5 8 6 12.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </>
    );
  }

  const client = await getClient(clientId);
  if (!client || isCreatorClient(client)) notFound();
  const reports = await listClientReports(client.id);
  const months = reportMonths(reports);
  const month = isMonth(one(sp.month)) && months.includes(one(sp.month)) ? one(sp.month) : (reports[0]?.month ?? months[1] ?? months[0]);
  const tab = one(sp.tab) === "internal" ? "internal" : "external";
  const forMonth = reports.filter((r) => r.month === month);
  const internal = forMonth.find((r) => r.audience === "internal");
  const external = forMonth.find((r) => r.audience === "external");
  const current = tab === "internal" ? internal : external;
  const href = (m: string, t: string) => `/reports?client=${encodeURIComponent(client.id)}&month=${m}&tab=${t}`;
  // A pending external report shows the text as edited in Review.
  const body = current ? (current.audience === "external" && current.status === "draft" && current.draftBody ? current.draftBody : current.body) : "";

  return (
    <>
      <PageHeader
        crumb={<Link href={`/clients/${client.id}`}>{client.name}</Link>}
        title="Reports"
        subtitle={
          <>
            Owner:{" "}
            {client.ownerEmail ? <span className="break-all text-text">{client.ownerEmail}</span> : <span>not set</span>}
            {" · "}
            <Link href={`/clients/${client.id}/settings#owner`} className="link">{client.ownerEmail ? "Change" : "Add owner email"}</Link>
          </>
        }
      />

      {/* Months */}
      <nav aria-label="Month" className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
        <ul className="chips g-months w-max flex-nowrap">
          {months.map((m) => {
            const rs = reports.filter((r) => r.month === m);
            const ext = rs.find((r) => r.audience === "external");
            const dot = ext?.status === "sent" ? "is-ok" : ext?.status === "approved" ? "is-ink" : rs.length ? "is-warn" : "is-idle";
            return (
              <li key={m}>
                <Link href={href(m, tab)} aria-current={m === month ? "page" : undefined} className="chip">
                  <span className={cx("status", dot)}>{monthLabel(m, "short")}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <section className="sec mt-8">
        {/* Tabs */}
        {/* Packed from the left like every other .tabs row; on a phone the two (each two lines) share the width. */}
        <div role="tablist" aria-label="Audience" className="tabs max-sm:grid max-sm:grid-cols-2 max-sm:gap-6">
          {(["external", "internal"] as const).map((t) => {
            const r = t === "internal" ? internal : external;
            const on = t === tab;
            return (
              <Link
                key={t}
                role="tab"
                aria-selected={on}
                href={href(month, t)}
                className="flex-col items-start! justify-center gap-0! justify-self-start whitespace-normal py-2 sm:flex-row sm:items-baseline! sm:justify-start sm:gap-3!"
              >
                <span>{t === "external" ? "External · for the owner" : "Internal · team only"}</span>
                <span className="font-normal">{statusChip(r)}</span>
              </Link>
            );
          })}
        </div>

        <div className="pt-6">
          {!current ? (
            <div className="flex flex-col items-start gap-4">
              <p className="meta">
                No {tab} report for {monthLabel(month)} yet.{" "}
                {internal || external ? "" : "Claude drafts both on the 1st of each month, or ask now."}
              </p>
              <ReportRequestButton action={requestReportAction.bind(null, client.id, month)} />
            </div>
          ) : (
            <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_16rem] lg:gap-16">
              <article className="min-w-0">
                {current.audience === "internal" && (
                  <p className="notice mb-4"><span className="status is-info">Team only. Never sent to the owner.</span></p>
                )}
                <ReportMarkdown body={body} />
              </article>

              <aside className="flex min-w-0 flex-col items-start gap-3 max-lg:border-t max-lg:border-border max-lg:pt-4">
                <p className="meta">
                  {current.createdBy === "claude" ? "Drafted by Claude" : "Written"} · updated {formatDate(current.updatedAt, true)}
                  {current.sentAt && <> · sent {formatDate(current.sentAt, true)}{current.sentTo ? ` to ${current.sentTo}` : ""}</>}
                </p>
                <CopyButton text={markdownToPlainText(body)} label="Copy as text" className="lg:w-full" />
                {current.audience === "external" && current.status === "draft" && current.draftId && (
                  <LinkButton href={`/review?client=${encodeURIComponent(client.id)}#d-${current.draftId}`} variant="secondary" className="lg:w-full">
                    {current.draftStatus === "rejected" ? "See it in Review" : "Review & approve"}
                  </LinkButton>
                )}
                {current.audience === "external" && current.status === "approved" && (
                  <ReportSendActions
                    business={client.name}
                    ownerEmail={client.ownerEmail}
                    send={client.ownerEmail ? sendReportAction.bind(null, current.id, client.id) : null}
                    markSent={markReportSentAction.bind(null, current.id, client.id)}
                  />
                )}
                {current.audience === "external" && current.status === "sent" && (
                  <p className="status is-ok whitespace-normal">Sent{current.sentTo ? ` to ${current.sentTo}` : ""}.</p>
                )}
                {current.audience === "external" && current.status === "draft" && (
                  <p className="hint">Approving it in Review doesn’t send anything; you send it from here after.</p>
                )}
              </aside>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
