import { NextResponse } from "next/server";
import { DROP_UPLOAD_TOKEN_MS, claimDropUpload, dropFolder, dropRateLimited, getDropByToken } from "@/lib/ops-drop";
import { MAX_UPLOAD_BYTES, blobEnabled } from "@/lib/uploads";

export const dynamic = "force-dynamic";

const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * POST /drop/<token>/upload — PUBLIC (the private link token is the key). Vercel Blob client-upload token exchange
 * for the owner drop page, so a flyer photo goes straight from the phone to Blob (same pipeline as the onboarding
 * form's /start/<token>/upload). Only exists when BLOB_READ_WRITE_TOKEN is set and only for a link that still works.
 * Files must go under drop/<link id>/<today>/.
 *
 * So a leaked link can't be used to fill the store: one token makes ONE file (no random suffix and no overwrite, so
 * a second upload to the same name is refused; the page puts its own random prefix on each name), it works for
 * DROP_UPLOAD_TOKEN_MS only, and a link gets DROP_UPLOADS_PER_DAY tokens a day (an atomic counter on the link,
 * taken when the token is handed out) and none while it is rate-limited.
 */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  if (!blobEnabled()) return NextResponse.json({ error: "Uploads are off." }, { status: 404 });
  const { token } = await params;
  const found = await getDropByToken(token);
  if (found.state === "unknown") return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (found.state !== "open") return NextResponse.json({ error: "This link is turned off." }, { status: 403 });
  const base = dropFolder(found.link.id);
  // The page may have been opened just before midnight (UTC): yesterday's folder is still fine.
  const now = new Date();
  const folders = [`${base}${day(now)}/`, `${base}${day(new Date(now.getTime() - 86_400_000))}/`];

  try {
    const { handleUpload } = await import("@vercel/blob/client");
    const body = await req.json();
    const result = await handleUpload({
      request: req,
      body,
      onBeforeGenerateToken: async (pathname) => {
        const folder = folders.find((f) => pathname.startsWith(f));
        if (!folder || pathname.includes("..") || pathname.length > 200 || pathname.slice(folder.length).includes("/")) throw new Error("Bad file name.");
        if (dropRateLimited(found.link)) throw new Error("Too many uploads. Try again later.");
        if (!(await claimDropUpload(found.link.id))) throw new Error("Too many uploads today. Try again tomorrow.");
        return {
          allowedContentTypes: ["image/*", "video/*", "application/pdf"],
          maximumSizeInBytes: MAX_UPLOAD_BYTES,
          addRandomSuffix: false,
          allowOverwrite: false,
          validUntil: Date.now() + DROP_UPLOAD_TOKEN_MS,
        };
      },
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Upload failed" }, { status: 400 });
  }
}
