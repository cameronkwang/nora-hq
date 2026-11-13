import { NextResponse } from "next/server";
import { getIntakeByToken } from "@/lib/ops-intake";
import { MAX_UPLOAD_BYTES, blobEnabled } from "@/lib/uploads";

export const dynamic = "force-dynamic";

/**
 * POST /start/<token>/upload — PUBLIC (the private link token is the key). Vercel Blob client-upload token
 * exchange for the onboarding form's optional "upload photos, videos or your logo" field, so files go straight
 * from the phone to Blob. Only exists when BLOB_READ_WRITE_TOKEN is set; only for links that are still open;
 * files must go under intake/<intake id>/.
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
        if (!pathname.startsWith(prefix) || pathname.includes("..") || pathname.length > 200) throw new Error("Bad file name.");
        return {
          allowedContentTypes: ["image/*", "video/*", "application/pdf"],
          maximumSizeInBytes: MAX_UPLOAD_BYTES,
          addRandomSuffix: true,
        };
      },
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Upload failed" }, { status: 400 });
  }
}
