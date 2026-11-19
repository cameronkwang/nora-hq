"use client";

import { buttonClass } from "@/components/ui";

/** A page that failed to render: the same paper column as the 404, with one way to try again. */
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="ps-page">
      <div className="ps-col">
        <p className="ps-mark">Nora HQ</p>
        <h1 className="display mt-10">Something went wrong</h1>
        <p className="sub">This page didn&apos;t load. Please try again in a moment.</p>
        <p className="mt-6">
          <button type="button" className={buttonClass("secondary")} onClick={reset}>
            Try again
          </button>
        </p>
      </div>
    </main>
  );
}
