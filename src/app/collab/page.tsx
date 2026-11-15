import type { Metadata } from "next";
import { CollabForm } from "@/components/collab-form";
import { COLLAB_COPY as C } from "@/lib/collab-copy";
import { collabFormToken } from "@/lib/ops-collab";
import { getPublicRateInfo } from "@/lib/ops-kit";

/**
 * PUBLIC: no sign-in, no app chrome (lives outside the (app) group; middleware lets "/collab" through).
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

export default async function CollabPage() {
  // The rate line and media-kit link come from Nora's media kit settings; never block the form on them.
  const rate = await getPublicRateInfo().catch(() => ({ rateLine: null, kitLive: false }));
  return (
    <main
      className="ps-page"
      // No tab bar here: the sticky action bar sits on the bottom edge and covers the home indicator itself.
      style={{ ["--tabbar-h" as string]: "0px" }}
    >
      <noscript>
        <style>{NO_JS_CSS}</style>
      </noscript>
      <div className="ps-col">
        <header className="ps-hero mb-10">
          <p className="ps-lead">{C.handle}</p>
          <h1 className="display">{C.title}</h1>
          <p className="sub">{C.intro}</p>
          {(rate.rateLine || rate.kitLive) && (
            <div className="notice mt-6">
              {rate.rateLine && <p className="min-w-0 font-medium">{rate.rateLine}</p>}
              {rate.kitLive && (
                <a href="/kit" className="link">
                  {C.mediaKitLink} →
                </a>
              )}
            </div>
          )}
          <p className="meta mt-3">{C.timeNote}</p>
        </header>

        <CollabForm token={collabFormToken()} />

        <p className="meta mt-8">{C.footer}</p>
      </div>
    </main>
  );
}
