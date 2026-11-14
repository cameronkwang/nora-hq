import { NextResponse } from "next/server";
import { INTAKE_UPLOAD_TOKEN_MS, claimIntakeUpload, getIntakeByToken } from "@/lib/ops-intake";
import { MAX_UPLOAD_BYTES, blobEnabled } from "@/lib/uploads";

export const dynamic = "force-dynamic";

/**
 * POST /start/<token>/upload — PUBLIC (the private link token is the key). Vercel Blob client-upload token
 * exchange for the onboarding form's optional "upload photos, videos or your logo" field, so files go straight
 * from the phone to Blob. Only exists when BLOB_READ_WRITE_TOKEN is set; only for links that are still open (not
 * sent, turned off or expired, and the business is Active); files must go straight under intake/<intake id>/.
 *
 * So a forwarded link can't be used to fill the store (the same limits as /drop/<token>/upload): one token makes
 * ONE file (no random suffix and no overwrite, so a second upload to the same name is refused; the page puts its
 * own random prefix on each name), it works for INTAKE_UPLOAD_TOKEN_MS only, and a link gets
 * INTAKE_UPLOADS_PER_DAY tokens a day (an atomic counter on the link, taken when the token is handed out).
 */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  if (!blobEnabled()) return NextResponse.json({ error: "Uploads are off." }, { status: 404 });
  const { token } = await params;
  const link = await getIntakeByToken(token);
  if (link.state !== "open") return NextResponse.json({ error: "This link has expired." }, { status: 403 });
  const prefix = `intake/${link.intake.id}/`;

  try {
    const { handleUpload } = await import("@vercel/blob/client");
    const body = await req.json();
    const result = await handleUpload({
      request: req,
      body,
      onBeforeGenerateToken: async (pathname) => {
        const name = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : "";
        if (!name || name.includes("/") || pathname.includes("..") || pathname.length > 200) throw new Error("Bad file name.");
        if (!(await claimIntakeUpload(link.intake.id))) throw new Error("Too many uploads today. Try again tomorrow.");
        return {
          allowedContentTypes: ["image/*", "video/*", "application/pdf"],
          maximumSizeInBytes: MAX_UPLOAD_BYTES,
          addRandomSuffix: false,
          allowOverwrite: false,
          validUntil: Date.now() + INTAKE_UPLOAD_TOKEN_MS,
        };
      },
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Upload failed" }, { status: 400 });
  }
}
