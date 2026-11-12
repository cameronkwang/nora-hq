"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { saveMediaKitSettings } from "@/lib/ops-kit";

export type KitFormState = { ok?: boolean; error?: string; message?: string; at?: number; enabled?: boolean };

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};
const lines = (s: string) => s.split(/\r?\n|,/).map((x) => x.trim()).filter(Boolean);

/** Save / Publish / Unpublish — the button pressed is sent as `intent`. */
export async function saveKitAction(_prev: KitFormState, fd: FormData): Promise<KitFormState> {
  const user = await requireUser();
  const intent = str(fd, "intent");
  const publish = intent === "publish" ? true : intent === "unpublish" ? false : undefined;
  const past = [...fd.getAll("pastCollabs").filter((v): v is string => typeof v === "string"), ...lines(str(fd, "pastCollabsExtra"))];
  try {
    const saved = await saveMediaKitSettings(
      {
        headline: str(fd, "headline"),
        bio: str(fd, "bio").replace(/\r\n/g, "\n"),
        rateLine: str(fd, "rateLine"),
        showRate: fd.get("showRate") === "on",
        showPastCollabs: fd.get("showPastCollabs") === "on",
        pastCollabs: past,
        contactEmail: str(fd, "contactEmail"),
        showCities: fd.get("showCities") === "on",
        styles: lines(str(fd, "styles")),
      },
      user.email,
      publish,
    );
    revalidatePath("/kit-settings");
    revalidatePath("/kit");
    revalidatePath("/collab");
    return {
      ok: true,
      at: Date.now(),
      enabled: saved.enabled,
      message: publish === true ? "Published — your media kit is live at /kit." : publish === false ? "Unpublished — /kit is hidden again." : "Saved.",
    };
  } catch (e) {
    const error = e instanceof z.ZodError ? e.issues[0]?.message ?? "Check the fields." : e instanceof Error ? e.message : "Couldn't save";
    return { error, at: Date.now() };
  }
}
