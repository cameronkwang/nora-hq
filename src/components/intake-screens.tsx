import type { ReactNode } from "react";
import type { IntakeCopy } from "@/lib/intake-copy";

/** Static screens for the onboarding form (thank-you, already sent, expired). No hooks — usable from server and client. */

export function IntakeThanks({ C, name }: { C: IntakeCopy; name: string }) {
  return (
    <div role="status" className="px-1 py-6 text-center sm:px-4">
      <span aria-hidden className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-ok-soft text-2xl text-ok">✓</span>
      <h2 className="text-2xl font-semibold tracking-tight">{C.thanks.title(name || "")}</h2>
      <p className="mx-auto mt-2 max-w-sm text-[17px] leading-relaxed text-muted">{C.thanks.body}</p>
      <div className="mx-auto mt-8 max-w-sm text-left">
        <h3 className="mb-3 text-[16px] font-semibold">{C.thanks.nextTitle}</h3>
        <ol className="space-y-3">
          {C.thanks.next.map((s, i) => (
            <li key={i} className="flex gap-3 text-[16px] leading-relaxed">
              <span aria-hidden className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent">{i + 1}</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
      </div>
      <p className="mx-auto mt-8 max-w-sm text-[15px] text-muted">{C.thanks.foot}</p>
    </div>
  );
}

export function IntakeNotice({ icon, title, children }: { icon: string; title: string; children: ReactNode }) {
  return (
    <div role="status" className="px-1 py-8 text-center sm:px-4">
      <span aria-hidden className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-accent-soft text-2xl">{icon}</span>
      <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
      <div className="mx-auto mt-3 max-w-sm space-y-3 text-[17px] leading-relaxed text-muted">{children}</div>
    </div>
  );
}

export function IntakeAlready({ C }: { C: IntakeCopy }) {
  return (
    <IntakeNotice icon="✓" title={C.already.title}>
      <p>{C.already.body}</p>
      <p>{C.already.change}</p>
    </IntakeNotice>
  );
}

export function IntakeExpired({ C }: { C: IntakeCopy }) {
  return (
    <IntakeNotice icon="🔗" title={C.expired.title}>
      <p>{C.expired.body}</p>
    </IntakeNotice>
  );
}
