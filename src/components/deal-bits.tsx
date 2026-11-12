import type { Deal, DealComp, DealStatus, PaymentStatus } from "@/lib/schema";
import { APP_TZ, formatDate, today as todayNY } from "@/lib/dates";
import { isOverdue } from "@/lib/ops-deals";
import { Badge } from "./ui";

/** Small presentational pieces for collab deals. Server components (they read lib/ops-deals helpers). */

export const COMP_LABEL: Record<DealComp, string> = { paid: "Paid", paid_hosted: "Paid + hosted", gifted: "Gifted", affiliate: "Affiliate" };
export const DEAL_STATUS_LABEL: Record<DealStatus, string> = {
  planning: "Planning", scheduled: "Scheduled", shot: "Shot", posted: "Posted", complete: "Complete", cancelled: "Cancelled",
};
export const PAYMENT_LABEL: Record<PaymentStatus, string> = { not_requested: "Not invoiced", requested: "Invoiced", paid: "Paid", not_applicable: "No payment" };

const STATUS_TONE: Record<DealStatus, "neutral" | "accent" | "ok" | "info" | "warn"> = {
  planning: "neutral", scheduled: "info", shot: "accent", posted: "ok", complete: "ok", cancelled: "neutral",
};

export function DealStatusBadge({ status }: { status: DealStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{DEAL_STATUS_LABEL[status]}</Badge>;
}

/** "$600" / "$1,250.50" — whole dollars drop the cents. */
export function formatMoney(cents: number | null | undefined): string {
  if (cents == null) return "";
  const whole = cents % 100 === 0;
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
}

/** Cents → the dollars text shown in the amount field ("600", "1250.50"). */
export function centsToDollarsInput(cents: number | null | undefined): string {
  if (cents == null) return "";
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

export function compText(d: Pick<Deal, "compType" | "amountCents">): string {
  const amt = d.compType === "gifted" ? "" : formatMoney(d.amountCents);
  return [COMP_LABEL[d.compType], amt].filter(Boolean).join(" · ");
}

/** Payment chip. Requested and past its due date → red "Overdue". */
export function PaymentChip({ deal, today = todayNY() }: { deal: Pick<Deal, "paymentStatus" | "paymentDueDate" | "compType" | "status">; today?: string }) {
  if (deal.paymentStatus === "not_applicable" || (deal.compType === "gifted" && deal.paymentStatus !== "paid")) return <Badge>Gifted</Badge>;
  if (deal.paymentStatus === "paid") return <Badge tone="ok">Paid</Badge>;
  if (isOverdue(deal, today)) return <Badge tone="danger">Overdue · was due {formatDate(deal.paymentDueDate)}</Badge>;
  if (deal.paymentStatus === "requested") return <Badge tone="warn">Invoiced{deal.paymentDueDate ? ` · due ${formatDate(deal.paymentDueDate)}` : ""}</Badge>;
  if (deal.status === "planning" || deal.status === "scheduled" || deal.status === "cancelled") return <Badge>Not invoiced</Badge>;
  return <Badge tone="warn">To invoice</Badge>;
}

/** "Sat, Nov 14 · 7:30 PM" in New York time; "Today · 7:30 PM" / "Tomorrow · …" when close. */
export function formatVisit(d: Date | null | undefined, now = new Date()): string {
  if (!d) return "";
  const day = d.toLocaleDateString("en-CA", { timeZone: APP_TZ });
  const t = todayNY(now);
  const tomorrow = todayNY(new Date(now.getTime() + 86_400_000));
  const time = d.toLocaleTimeString("en-US", { timeZone: APP_TZ, hour: "numeric", minute: "2-digit" });
  const label = day === t ? "Today" : day === tomorrow ? "Tomorrow" : d.toLocaleDateString("en-US", { timeZone: APP_TZ, weekday: "short", month: "short", day: "numeric", ...(day.slice(0, 4) !== t.slice(0, 4) ? { year: "numeric" } : {}) });
  return `${label} · ${time}`;
}

export function mapsLinks(address: string) {
  const q = encodeURIComponent(address);
  return { apple: `https://maps.apple.com/?q=${q}`, google: `https://www.google.com/maps/search/?api=1&query=${q}` };
}

export function telHref(phone: string, kind: "tel" | "sms" = "tel") {
  return `${kind}:${phone.replace(/[^\d+]/g, "")}`;
}

/** The FTC line for this comp type. */
export function disclosureLine(comp: DealComp): string {
  if (comp === "gifted") return "Disclose: “gifted” / #gifted — on screen and in the caption.";
  if (comp === "affiliate") return "Disclose: #ad + say it’s an affiliate/commission link — on screen and in the caption.";
  return "Disclose: #ad + turn on the Paid partnership label — on screen and in the caption.";
}

export function DeliverablesProgress({ posted, total }: { posted: number; total: number }) {
  if (!total) return <span className="text-xs text-muted">No deliverables</span>;
  return (
    <span className={posted === total ? "text-xs font-medium text-ok" : "text-xs text-muted"}>
      {posted}/{total} posted
    </span>
  );
}
