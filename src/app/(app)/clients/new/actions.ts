"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { onboardClient } from "@/lib/ops-onboarding";
import { ACCEPTED_SERVICES, joinOutreachAreas, normalizeServices, type AnyService } from "@/lib/onboard-services";
import { parseBusinessInput } from "@/lib/onboard-parse";
import type { FormState } from "../actions";

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};
const opt = (fd: FormData, k: string) => str(fd, k).trim() || null;

function errorMessage(e: unknown): string {
  if (e instanceof z.ZodError) return e.issues.map((i) => i.message).join("; ");
  if (e instanceof Error) return e.message;
  return "Something went wrong";
}

/** A pasted facebook.com link is a Facebook Page, not their website. */
const isFacebookUrl = (u: string) => /^(https?:\/\/)?((www|m|web)\.)?(facebook|fb)\.com\//i.test(u.trim());

/**
 * New client (/clients/new): name or pasted link, the six service chips, and — with Local creator outreach —
 * where to look for creators. Creates the business with its starting plan, Getting started checklist and
 * Claude's research ask; from a lead it also marks the lead Won. Lands on the business page.
 * Works without JS (the server parses the same fields).
 */
export async function onboardNewClientAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = parseBusinessInput(str(fd, "q"));
  const name = (parsed.kind === "name" ? parsed.name : str(fd, "name")).trim();
  if (!name) return { error: parsed.kind === "name" ? "Give the business a name." : "Add the business name too." };

  const raw = fd.getAll("services").filter((v): v is AnyService => typeof v === "string" && (ACCEPTED_SERVICES as readonly string[]).includes(v));
  const services = normalizeServices(raw);
  if (services.length === 0) return { error: "Pick at least one thing we'll do for them." };

  const pastedUrl = parsed.kind === "website" ? parsed.url : null;
  const pastedFacebook = pastedUrl && isFacebookUrl(pastedUrl) ? pastedUrl : null;
  const outreachAreas = services.includes("creators")
    ? joinOutreachAreas(fd.getAll("outreachArea").filter((v): v is string => typeof v === "string"), str(fd, "outreachAreasOther"))
    : null;
  const leadId = opt(fd, "leadId");

  let id: string;
  try {
    id = await onboardClient(
      {
        name,
        location: opt(fd, "location"),
        instagramHandle: parsed.kind === "instagram" ? parsed.handle : opt(fd, "instagramHandle"),
        tiktokHandle: parsed.kind === "tiktok" ? parsed.handle : opt(fd, "tiktokHandle"),
        website: pastedUrl && !pastedFacebook ? pastedUrl : opt(fd, "website"),
        facebookPage: pastedFacebook ?? opt(fd, "facebookPage"),
        googleMapsUrl: parsed.kind === "maps" ? parsed.url : opt(fd, "googleMapsUrl"),
        copyPlanFrom: opt(fd, "copyPlanFrom"),
        outreachAreas,
        services,
        leadId,
      },
      user.email,
    );
  } catch (e) {
    return { error: errorMessage(e) };
  }
  revalidatePath("/clients");
  revalidatePath(`/clients/${id}`);
  revalidatePath(`/clients/${id}/settings`);
  revalidatePath("/", "layout");
  revalidatePath("/tasks");
  revalidatePath("/asks");
  if (leadId) {
    revalidatePath("/leads");
    revalidatePath(`/leads/${leadId}`);
  }
  redirect(`/clients/${id}?welcome=1${leadId ? "&lead=1" : ""}`);
}
