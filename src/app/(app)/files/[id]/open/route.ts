import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { assigneeFor, getUser } from "@/lib/auth";
import { getFile, markFileOpened } from "@/lib/ops-files";

export const dynamic = "force-dynamic";

/** Opens a file from the Files tab. Signed-in people only; the first time Nora opens one it stops being "New". */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));
  const { id } = await params;
  const file = await getFile(id);
  if (!file) return new NextResponse("That file isn't here any more.", { status: 404 });
  if (assigneeFor(user) === "nora" && !file.openedAt) {
    await markFileOpened(id);
    revalidatePath("/", "layout");
  }
  return NextResponse.redirect(new URL(file.url, req.url));
}
