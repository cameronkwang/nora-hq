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

  return (
    <div className="max-w-xl">
      <header className="page-head">
        <p className="crumb">
          <Link href={`/deals/${deal.id}`} className="-my-3 inline-flex min-h-11 items-center md:pointer-fine:my-0 md:pointer-fine:min-h-0">Deal details</Link>
        </p>
        <h1 className="display break-words">{deal.businessName}</h1>
        <p className="sub g-meta">
          <span className="text-text">{deal.visitAt ? formatVisit(deal.visitAt) : "No visit time set"}</span>
          <span>{COMP_LABEL[deal.compType]}</span>
          {deal.contactName && <span>Ask for {deal.contactName}</span>}
        </p>
      </header>

      {error && <p role="alert" className="notice mb-6"><span className="status is-danger">{error}</span></p>}

      {(maps || phone) && (
        <div className="mb-8 grid gap-3">
          {maps && (
            <div>
              <p className="eyebrow">Address · tap for Maps</p>
              <a href={maps.apple} target="_blank" rel="noreferrer" className="link mt-1 inline-block text-[17px] font-medium leading-6">{deal.address}</a>
              <p>
                <a href={maps.google} target="_blank" rel="noreferrer" className="link-quiet inline-flex min-h-11 items-center underline underline-offset-[3px] md:pointer-fine:min-h-8">Open in Google Maps instead</a>
              </p>
            </div>
          )}
          {phone && (
            <div className="flex gap-2">
              <a href={telHref(phone)} className={cx(buttonClass("secondary"), "flex-1")}>
                <PhoneIcon /> Call
              </a>
              <a href={telHref(phone, "sms")} className={cx(buttonClass("secondary"), "flex-1")}>
                <TextIcon /> Text
              </a>
            </div>
          )}
        </div>
      )}

      {(deal.menuNotes || deal.dietaryNotes || deal.filmingNotes) && (
        <div className="g-notes border-t border-border">
          {deal.menuNotes && <Note title="Order / signature dishes" text={deal.menuNotes} strong />}
          {deal.dietaryNotes && <Note title="Dietary" text={deal.dietaryNotes} />}
          {deal.filmingNotes && <Note title="Filming notes" text={deal.filmingNotes} />}
        </div>
      )}

      <div role="note" className="notice block">
        <p className="status is-warn whitespace-normal font-medium">{disclosureLine(deal.compType)}</p>
        <p className="meta mt-1">FTC: disclose #ad / Paid partnership / gifted, on screen and in the caption, every post.</p>
      </div>

      <section aria-labelledby="shots-h" className="sec">
        <header className="sec-head">
          <h2 id="shots-h" className="title">Shot list</h2>
        </header>
        <DealShotList dealId={deal.id} shots={deal.shotList} large />
      </section>

      {deal.deliverables.length > 0 && (
        <section aria-labelledby="del-h" className="sec">
          <header className="sec-head">
            <h2 id="del-h" className="title">Deliverables</h2>
          </header>
          <ul className="list">
            {deal.deliverables.map((d) => (
              <li key={d.id} className="row">
                <span className={cx("row-title is-plain", d.postedAt && "text-muted line-through")}>{DELIVERABLE_LABEL[d.kind]}</span>
                <span className="meta">{d.postedAt ? "Posted" : d.dueDate ? `due ${formatDate(d.dueDate)}` : ""}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="g-bar sticky-actions mt-8">
        {shotDone ? (
          <Link href={`/deals/${deal.id}`} className={cx(buttonClass("secondary"), "h-auto min-h-12 w-full whitespace-normal py-2 text-center leading-6")}>
            Marked shot ✓. Add post links on the deal
          </Link>
        ) : (
          <form action={setDealStatusAction} className="w-full">
            <input type="hidden" name="id" value={deal.id} />
            <input type="hidden" name="status" value="shot" />
            <input type="hidden" name="back" value={`/deals/${deal.id}/visit`} />
            <SubmitButton pendingLabel="Saving…" className="min-h-12 w-full">Mark shot</SubmitButton>
          </form>
        )}
      </div>
    </div>
  );
}

function Note({ title, text, strong = false }: { title: string; text: string; strong?: boolean }) {
  return (
    <div>
      <h2 className="eyebrow">{title}</h2>
      <p className={cx(strong && "is-strong")}>{text}</p>
    </div>
  );
}

function PhoneIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <path d="M5 2.5h2.5l1.2 3.5-1.8 1.2a10 10 0 005 5l1.2-1.8 3.5 1.2V14a2 2 0 01-2 2A12.5 12.5 0 013 4.5a2 2 0 012-2z" strokeLinejoin="round" />
    </svg>
  );
}

function TextIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <path d="M3 5a2 2 0 012-2h10a2 2 0 012 2v7a2 2 0 01-2 2H8l-4 3v-3.2A2 2 0 013 12V5z" strokeLinejoin="round" />
    </svg>
  );
}
