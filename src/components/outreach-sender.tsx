import Link from "next/link";
import type { Creator } from "@/lib/schema";
import { SEND_FROM_LABEL, emailSendPlan, sendFromText, senderMismatch, statsCheck, type AlreadyPosted, type OutreachProfile, type SendChannel } from "@/lib/outreach-profile";
import { cx, formatNumber } from "./ui";

/**
 * Review-queue pieces for creator outreach. Server-component safe (no hooks).
 *  - SenderChip: "Send from @x (not Nora) · Offer: …" — which account the message goes out from, and the standing offer.
 *  - CreatorCheckLine: "10.5K TikTok · checked 3d ago · no prior posts".
 */

export function SenderChip({
  profile,
  channel,
  gmailAddress,
  pending,
}: {
  profile: OutreachProfile;
  channel: SendChannel;
  /** The connected Gmail outreach inbox, if any (emails only). */
  gmailAddress?: string | null;
  /** The draft hasn't been approved yet: say what approving an email will do. */
  pending?: boolean;
}) {
  const settings = `/clients/${profile.clientId}/settings#outreach-profile`;
  const plan = channel === "email" ? emailSendPlan(profile, gmailAddress) : null;
  const mismatch = senderMismatch(profile, channel);
  const kind = profile.sendFromKind && profile.sendFromKind !== "other" ? SEND_FROM_LABEL[profile.sendFromKind] : null;

  return (
    <div className="flex flex-col gap-1.5">
      {profile.sendFrom ? (
        <p className="break-words rounded-lg bg-accent-soft px-3 py-2 text-sm">
          <span className="font-semibold">
            Send from <span className="text-accent">{profile.sendFrom}</span>
          </span>{" "}
          <span className="text-muted">({kind ? `${kind}, ` : ""}not Nora)</span>
          {" · "}
          {profile.creatorOffer ? (
            <>Offer: {profile.creatorOffer}</>
          ) : (
            <>
              No standing offer saved.{" "}
              <Link href={settings} className="font-medium text-accent hover:underline">Add it</Link>
            </>
          )}
        </p>
      ) : (
        <p className="break-words rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
          <span className="font-semibold">No sender saved for {profile.business}.</span> It goes out from the business&apos;s own account, not Nora&apos;s.{" "}
          <Link href={settings} className="font-semibold underline">Set it</Link>
          {profile.creatorOffer ? <> · Offer: {profile.creatorOffer}</> : <> · No standing offer saved.</>}
        </p>
      )}
      {plan && pending && plan.auto && (
        <p className={cx("text-xs", profile.sendFrom ? "text-muted" : "font-medium text-warn")}>
          Approving emails this right away from {plan.from} (the connected Gmail).
        </p>
      )}
      {plan && pending && !plan.auto && plan.from && (
        <p className="text-xs text-muted">Approving doesn&apos;t email it: you send it from {sendFromText(profile, channel)}, then mark it sent.</p>
      )}
      {mismatch && <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">{mismatch}</p>}
    </div>
  );
}

export function CreatorCheckLine({
  creator,
  channel,
  posted,
  business,
  now,
}: {
  creator: Pick<Creator, "instagramFollowers" | "tiktokFollowers" | "statsCheckedAt" | "statsSource">;
  channel: SendChannel;
  posted: AlreadyPosted | null;
  business: string;
  now?: Date;
}) {
  const check = statsCheck(creator, now);
  const ig = creator.instagramFollowers != null ? `${formatNumber(creator.instagramFollowers)} IG` : null;
  const tt = creator.tiktokFollowers != null ? `${formatNumber(creator.tiktokFollowers)} TikTok` : null;
  const followers = channel === "tiktok_dm" ? (tt ?? ig) : channel === "instagram_dm" ? (ig ?? tt) : [ig, tt].filter(Boolean).join(" · ") || null;
  const checkCls = check.state === "fresh" ? "text-muted" : "font-medium text-warn";
  return (
    <p className="break-words text-sm">
      <span className="font-medium tabular-nums">{followers ?? "Followers unknown"}</span>
      {" · "}
      {creator.statsSource && check.state !== "never" ? (
        <a href={creator.statsSource} target="_blank" rel="noopener noreferrer nofollow" className={cx(checkCls, "hover:underline")}>{check.label}</a>
      ) : (
        <span className={checkCls}>{check.label}</span>
      )}
      {" · "}
      {posted ? (
        <span className="font-medium text-danger">
          already posted about {business}
          {posted.url && (
            <>
              {" "}
              <a href={posted.url} target="_blank" rel="noopener noreferrer nofollow" className="underline">see post ↗</a>
            </>
          )}
        </span>
      ) : (
        <span className="text-muted">no prior posts</span>
      )}
    </p>
  );
}
