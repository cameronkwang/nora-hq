import { NextResponse } from "next/server";
import { assigneeFor, getUser } from "@/lib/auth";
import { MAX_UPLOAD_BYTES, SHARED_FILE_FOLDER, SHARED_FILE_TYPES, UploadError, blobEnabled, filesFrom, saveSharedFile } from "@/lib/uploads";

export const dynamic = "force-dynamic";

/**
 * POST /api/files/upload: stores one file for Nora's Files tab (PDFs, pictures, documents). Cameron's side only.
 *  - application/json: Vercel Blob client-upload token exchange, so the browser sends the file straight to Blob.
 *  - multipart/form-data with a "file" field: saved by the server (local dev).
 * Returns { url, name, contentType, size }. The file is listed for Nora only once sendFile() records it.
 */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (assigneeFor(user) === "nora") return NextResponse.json({ error: "Only Cameron sends files here." }, { status: 403 });

  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    if (!blobEnabled()) return NextResponse.json({ error: "Direct uploads need BLOB_READ_WRITE_TOKEN." }, { status: 400 });
    try {
      const { handleUpload } = await import("@vercel/blob/client");
      const body = await req.json();
      const result = await handleUpload({
        request: req,
        body,
        onBeforeGenerateToken: async (pathname) => {
          if (!pathname.startsWith(SHARED_FILE_FOLDER)) throw new Error("Wrong folder.");
          return { allowedContentTypes: SHARED_FILE_TYPES, maximumSizeInBytes: MAX_UPLOAD_BYTES, addRandomSuffix: true };
        },
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
  const [file] = filesFrom(form, "file");
  if (!file) return NextResponse.json({ error: "No file received." }, { status: 400 });
  try {
    return NextResponse.json(await saveSharedFile(file));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Upload failed" }, { status: e instanceof UploadError ? 400 : 500 });
  }
}
