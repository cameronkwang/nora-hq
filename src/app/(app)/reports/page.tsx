import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getClient, isCreatorClient, listBusinesses } from "@/lib/data";
import { formatDate, isMonth, monthLabel } from "@/lib/dates";
import { listClientReports, reportMonths, type ReportRow } from "@/lib/ops-reports";
import { Badge, Card, EmptyState, LinkButton, PageHeader, clientLabel, cx } from "@/components/ui";
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
  if (!r) return <Badge>Not started</Badge>;
  if (r.audience === "internal") return <Badge tone="info">Team only</Badge>;
  if (r.status === "sent") return <Badge tone="ok">Sent</Badge>;
  if (r.status === "approved") return <Badge tone="accent">Approved · not sent</Badge>;
  if (r.draftStatus === "rejected") return <Badge tone="neutral">Sent back</Badge>;
  return <Badge tone="warn">Needs review</Badge>;
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
          <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
            {businesses.map((b) => (
              <li key={b.id}>
                <Link href={`/reports?client=${encodeURIComponent(b.id)}`} className="flex min-h-12 items-center px-4 py-3 text-sm font-medium hover:bg-surface-2">
                  {clientLabel(b)}
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
        title={
          <>
            <Link href={`/clients/${client.id}`} className="hover:underline">{client.name}</Link>
            <span className="text-muted"> · Reports</span>
          </>
        }
        subtitle={
          <>
            Owner:{" "}
            {client.ownerEmail ? <span className="break-all font-medium text-text">{client.ownerEmail}</span> : <span>not set</span>}
            {" · "}
            <Link href={`/clients/${client.id}/settings#owner`} className="text-accent hover:underline">{client.ownerEmail ? "Change" : "Add owner email"}</Link>
          </>
        }
      />

      {/* Months */}
      <nav aria-label="Month" className="-mx-4 mb-4 overflow-x-auto px-4 md:mx-0 md:px-0">
        <ul className="flex w-max gap-2">
          {months.map((m) => {
            const rs = reports.filter((r) => r.month === m);
            const ext = rs.find((r) => r.audience === "external");
            const dot = ext?.status === "sent" ? "bg-ok" : ext?.status === "approved" ? "bg-accent" : rs.length ? "bg-warn" : "bg-border";
            return (
              <li key={m}>
                <Link
                  href={href(m, tab)}
                  aria-current={m === month ? "page" : undefined}
                  className={cx("inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-medium", m === month ? "border-accent bg-accent-soft text-accent" : "border-border bg-surface hover:bg-surface-2")}
                >
                  <span aria-hidden className={cx("inline-block size-2 rounded-full", dot)} />
                  {monthLabel(m, "short")}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <Card padded={false}>
        {/* Tabs */}
        <div role="tablist" aria-label="Audience" className="grid grid-cols-2 border-b border-border">
          {(["external", "internal"] as const).map((t) => {
            const r = t === "internal" ? internal : external;
            const on = t === tab;
            return (
              <Link
                key={t}
                role="tab"
                aria-selected={on}
                href={href(month, t)}
                className={cx("flex min-h-12 flex-col items-start justify-center gap-1 px-4 py-2 sm:flex-row sm:items-center sm:gap-2", on ? "border-b-2 border-accent bg-surface" : "bg-surface-2/50 text-muted hover:bg-surface-2")}
              >
                <span className="text-sm font-semibold">{t === "external" ? "External · for the owner" : "Internal · team only"}</span>
                {statusChip(r)}
              </Link>
            );
          })}
        </div>

        <div className="p-4 sm:p-6">
          {!current ? (
            <div className="flex flex-col items-start gap-3">
              <p className="text-sm text-muted">
                No {tab} report for {monthLabel(month)} yet.{" "}
                {internal || external ? "" : "Claude drafts both on the 1st of each month — or ask now."}
              </p>
              <ReportRequestButton action={requestReportAction.bind(null, client.id, month)} />
            </div>
          ) : (
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
              <article className="min-w-0">
                {current.audience === "internal" && (
                  <p className="mb-3 rounded-lg bg-info-soft px-3 py-2 text-xs text-info">Team only — never sent to the owner.</p>
                )}
                <ReportMarkdown body={body} />
              </article>

              <aside className="flex min-w-0 flex-col gap-3 lg:border-l lg:border-border lg:pl-6">
                <p className="text-xs text-muted">
                  {current.createdBy === "claude" ? "Drafted by Claude" : "Written"} · updated {formatDate(current.updatedAt, true)}
                  {current.sentAt && <> · sent {formatDate(current.sentAt, true)}{current.sentTo ? ` to ${current.sentTo}` : ""}</>}
                </p>
                <CopyButton text={markdownToPlainText(body)} label="Copy as text" className="w-full" />
                {current.audience === "external" && current.status === "draft" && current.draftId && (
                  <LinkButton href={`/review?client=${encodeURIComponent(client.id)}#d-${current.draftId}`} variant="primary" className="w-full">
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
                  <p className="rounded-lg bg-ok-soft px-3 py-2 text-sm text-ok">Sent{current.sentTo ? ` to ${current.sentTo}` : ""}.</p>
                )}
                {current.audience === "external" && current.status === "draft" && (
                  <p className="text-xs text-muted">Approving it in Review doesn’t send anything — you send it from here after.</p>
                )}
              </aside>
            </div>
          )}
        </div>
      </Card>
    </>
  );
}
