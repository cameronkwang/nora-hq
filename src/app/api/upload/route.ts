import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { MAX_UPLOAD_BYTES, UploadError, blobEnabled, filesFrom, saveUpload } from "@/lib/uploads";

export const dynamic = "force-dynamic";

/**
 * POST /api/upload (signed-in users only; middleware also guards /api).
 *
 *  - multipart/form-data with one or more "file" / "files" fields → stores them via saveUpload()
 *    and returns { files: [{ url, name, contentType }], url, name, contentType } (top-level = first file).
 *  - application/json → Vercel Blob client-upload token exchange (used by components/upload-picker
 *    so large videos go browser → Blob directly, skipping the function body size limit).
 */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const type = req.headers.get("content-type") ?? "";

  if (type.includes("application/json")) {
    if (!blobEnabled()) return NextResponse.json({ error: "Direct uploads need BLOB_READ_WRITE_TOKEN." }, { status: 400 });
    try {
      const { handleUpload } = await import("@vercel/blob/client");
      const body = await req.json();
      const result = await handleUpload({
        request: req,
        body,
        onBeforeGenerateToken: async () => ({
          allowedContentTypes: ["image/*", "video/*"],
          maximumSizeInBytes: MAX_UPLOAD_BYTES,
          addRandomSuffix: true,
        }),
      });
      return NextResponse.json(result);
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Upload failed" }, { status: 400 });
    }
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Send multipart/form-data with a 'file' field." }, { status: 400 });
  }
  const files = [...filesFrom(form, "file"), ...filesFrom(form, "files")];
  if (!files.length) return NextResponse.json({ error: "No file received." }, { status: 400 });

  try {
    const saved = [];
    for (const f of files) saved.push(await saveUpload(f));
    return NextResponse.json({ files: saved, ...saved[0] });
  } catch (e) {
    const status = e instanceof UploadError ? 400 : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : "Upload failed" }, { status });
  }
}
