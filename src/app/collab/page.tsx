import type { Metadata } from "next";
import { CollabForm } from "@/components/collab-form";
import { COLLAB_COPY as C } from "@/lib/collab-copy";
import { collabFormToken } from "@/lib/ops-collab";

/**
 * PUBLIC — no sign-in, no app chrome (lives outside the (app) group; middleware lets "/collab" through).
 * Link-in-bio page where businesses ask to work with Nora. Copy lives in src/lib/collab-copy.ts.
 */

export const dynamic = "force-dynamic"; // the anti-spam timestamp is stamped per render

export const metadata: Metadata = {
  title: { absolute: C.pageTitle },
  description: C.metaDescription,
  robots: { index: false, follow: false },
  openGraph: { title: C.pageTitle, description: C.metaDescription },
};

// Without JavaScript the steps can't switch, so show every step as one long form and keep only "Send".
const NO_JS_CSS = `
.collab-step[data-off="true"], .collab-cond[data-off="true"] { display: block; }
.collab-submit[data-off="true"] { display: inline-flex; margin-left: auto; }
.collab-js { display: none !important; }
.collab-nojs { display: inline; }
.collab-step + .collab-step { margin-top: 2.5rem; padding-top: 2rem; border-top: 1px solid var(--border); }
`;

export default function CollabPage() {
  return (
    <main
      className="min-h-dvh px-[max(1rem,env(safe-area-inset-left))] pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))] sm:pt-14"
      // No tab bar here: sticky actions sit on the bottom edge (above the home indicator).
      style={{ ["--tabbar-h" as string]: "env(safe-area-inset-bottom)" }}
    >
      <noscript>
        <style>{NO_JS_CSS}</style>
      </noscript>
      <div className="mx-auto w-full max-w-xl">
        <header className="mb-8 text-center sm:mb-10">
          <span
            aria-hidden
            className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-accent text-2xl font-semibold text-accent-fg shadow-sm"
          >
            N
          </span>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{C.title}</h1>
          <p className="mt-1.5 text-[15px] font-medium text-accent">{C.handle}</p>
          <p className="mx-auto mt-4 max-w-md text-[16px] leading-relaxed text-muted">{C.intro}</p>
          <p className="mt-3 text-sm text-muted">{C.timeNote}</p>
        </header>

        <div className="rounded-3xl border border-border bg-surface p-4 shadow-sm sm:p-8">
          <CollabForm token={collabFormToken()} />
        </div>

        <p className="mx-auto mt-6 max-w-sm text-center text-xs leading-relaxed text-muted">{C.footer}</p>
      </div>
    </main>
  );
}
