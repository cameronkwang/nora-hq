import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { DELIVERABLE_LABEL, getDeal } from "@/lib/ops-deals";
import { SubmitButton } from "@/components/client-form";
import { COMP_LABEL, disclosureLine, formatVisit, mapsLinks, telHref } from "@/components/deal-bits";
import { DealShotList } from "@/components/deal-shot-list";
import { buttonClass, cx } from "@/components/ui";
import { setDealStatusAction } from "../../actions";

export const dynamic = "force-dynamic";

/**
 * Visit mode: the one screen Nora keeps open on site. Phone-first, one hand: where/when, who to call,
 * what to order, the disclosure reminder and the shot list as big tap rows. "Mark shot" sits above the tab bar.
 */
export default async function VisitPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const deal = await getDeal(id);
  if (!deal) notFound();
  const maps = deal.address ? mapsLinks(deal.address) : null;
  const phone = deal.contactPhone;
  const shotDone = deal.status === "shot" || deal.status === "posted" || deal.status === "complete";
  const error = typeof sp.error === "string" ? sp.error : "";
  const action = "flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-border bg-surface px-3 text-[15px] font-medium active:bg-surface-2";

  return (
    <div className="mx-auto max-w-xl">
      <p className="mb-3 text-sm">
        <Link href={`/deals/${deal.id}`} className="inline-flex min-h-11 items-center text-muted hover:underline md:min-h-0">← Deal details</Link>
      </p>

      <header className="mb-4">
        <h1 className="text-3xl font-semibold leading-tight tracking-tight break-words">{deal.businessName}</h1>
        <p className="mt-1 text-lg text-muted">
          {deal.visitAt ? formatVisit(deal.visitAt) : "No visit time set"}
          <span className="text-base"> · {COMP_LABEL[deal.compType]}</span>
        </p>
        {deal.contactName && <p className="mt-0.5 text-sm text-muted">Ask for {deal.contactName}</p>}
      </header>

      {error && <p role="alert" className="mb-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

      {(maps || phone) && (
        <div className="mb-5 grid gap-2">
          {maps && (
            <>
              <a href={maps.apple} target="_blank" rel="noreferrer" className="block rounded-xl border border-border bg-surface px-4 py-3 active:bg-surface-2">
                <span className="block text-xs font-semibold text-muted">Address · tap for Maps</span>
                <span className="mt-0.5 block text-[17px] font-medium text-accent">{deal.address}</span>
              </a>
              <a href={maps.google} target="_blank" rel="noreferrer" className="-mt-1 self-start px-1 py-2 text-sm text-muted underline">Open in Google Maps instead</a>
            </>
          )}
          {phone && (
            <div className="flex gap-2">
              <a href={telHref(phone)} className={action}>
                <PhoneIcon /> Call
              </a>
              <a href={telHref(phone, "sms")} className={action}>
                <TextIcon /> Text
              </a>
            </div>
          )}
        </div>
      )}

      <div className="space-y-4">
        {deal.menuNotes && <Note title="Order / signature dishes" text={deal.menuNotes} strong />}
        {deal.dietaryNotes && <Note title="Dietary" text={deal.dietaryNotes} />}
        {deal.filmingNotes && <Note title="Filming notes" text={deal.filmingNotes} />}

        <p className="rounded-xl bg-warn-soft px-4 py-3 text-[15px] leading-snug text-warn">
          <span className="font-semibold">{disclosureLine(deal.compType)}</span>
          <span className="mt-1 block text-sm">FTC: disclose #ad / Paid partnership / gifted — on screen and in the caption, every post.</span>
        </p>

        <section aria-labelledby="shots-h">
          <h2 id="shots-h" className="mb-2 text-lg font-semibold">Shot list</h2>
          <DealShotList dealId={deal.id} shots={deal.shotList} large />
        </section>

        {deal.deliverables.length > 0 && (
          <section aria-labelledby="del-h">
            <h2 id="del-h" className="mb-2 text-lg font-semibold">Deliverables</h2>
            <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
              {deal.deliverables.map((d) => (
                <li key={d.id} className="flex min-h-12 items-center justify-between gap-3 px-4 py-2 text-[15px]">
                  <span className={cx(d.postedAt && "text-muted line-through")}>{DELIVERABLE_LABEL[d.kind]}</span>
                  <span className="text-sm text-muted">{d.postedAt ? "Posted" : d.dueDate ? `due ${formatDate(d.dueDate)}` : ""}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <div className="sticky-actions mt-6">
        {shotDone ? (
          <Link href={`/deals/${deal.id}`} className={cx(buttonClass("secondary"), "w-full !min-h-12 text-base shadow-sm")}>
            Marked shot ✓ — add post links on the deal
          </Link>
        ) : (
          <form action={setDealStatusAction}>
            <input type="hidden" name="id" value={deal.id} />
            <input type="hidden" name="status" value="shot" />
            <input type="hidden" name="back" value={`/deals/${deal.id}/visit`} />
            <SubmitButton pendingLabel="Saving…" className="w-full !min-h-12 text-base shadow-sm">Mark shot</SubmitButton>
          </form>
        )}
      </div>
    </div>
  );
}

function Note({ title, text, strong = false }: { title: string; text: string; strong?: boolean }) {
  return (
    <section className="rounded-xl border border-border bg-surface px-4 py-3">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</h2>
      <p className={cx("mt-1 whitespace-pre-line break-words leading-relaxed", strong ? "text-[17px]" : "text-[15px]")}>{text}</p>
    </section>
  );
}

function PhoneIcon() {
  return (
    <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <path d="M5 2.5h2.5l1.2 3.5-1.8 1.2a10 10 0 005 5l1.2-1.8 3.5 1.2V14a2 2 0 01-2 2A12.5 12.5 0 013 4.5a2 2 0 012-2z" strokeLinejoin="round" />
    </svg>
  );
}

function TextIcon() {
  return (
    <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <path d="M3 5a2 2 0 012-2h10a2 2 0 012 2v7a2 2 0 01-2 2H8l-4 3v-3.2A2 2 0 013 12V5z" strokeLinejoin="round" />
    </svg>
  );
}
