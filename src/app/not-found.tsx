import Link from "next/link";

export const metadata = { title: "Page not found" };

/** Any 404 (an unknown path, an unpublished /kit, a dead owner link): the public paper column, no app chrome. */
export default function NotFound() {
  return (
    <main className="ps-page">
      <div className="ps-col">
        <p className="ps-mark">Nora HQ</p>
        <h1 className="display mt-10">Page not found</h1>
        <p className="sub">This link doesn&apos;t go anywhere. It may have moved or been turned off.</p>
        <p className="mt-6">
          <Link href="/" className="link tap-target">
            Go to Nora HQ
          </Link>
        </p>
      </div>
    </main>
  );
}
