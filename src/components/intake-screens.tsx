import type { ReactNode } from "react";
import type { IntakeCopy } from "@/lib/intake-copy";

/** Static screens for the onboarding form (thank-you, already sent, expired). No hooks: usable from server and client. */

export function IntakeThanks({ C, name }: { C: IntakeCopy; name: string }) {
  return (
    <div role="status" data-intake-done="" className="ps-hero">
      <h2 className="display emoji">{C.thanks.title(name || "")}</h2>
      <p className="sub">{C.thanks.body}</p>
      <section className="sec">
        <header className="sec-head">
          <h3 className="title">{C.thanks.nextTitle}</h3>
        </header>
        <ol className="ps-steps-list sec-body">
          {C.thanks.next.map((s, i) => (
            <li key={i}>
              <span aria-hidden className="n">{i + 1}</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
      </section>
      <p className="meta mt-8">{C.thanks.foot}</p>
    </div>
  );
}

/** A short screen in place of the form: the serif title and a line or two. (`icon` is kept for callers; Ink draws no badge.) */
export function IntakeNotice({ title, children }: { icon?: string; title: string; children: ReactNode }) {
  return (
    <div role="status" className="ps-hero">
      <h2 className="display">{title}</h2>
      <div className="mt-3 space-y-3 text-muted">{children}</div>
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
