import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { IntakeForm } from "@/components/intake-form";
import { IntakeShell } from "@/components/intake-shell";
import { Status } from "@/components/ui";
import { parseIntakeLang, type IntakeLangCode } from "@/lib/intake-copy";
import { intakeAccessEmail, intakeFormSetup } from "@/lib/ops-intake";

/**
 * TEAM ONLY (signed in; not under the public "/start" prefix): "Preview what the owner sees".
 * The onboarding form exactly as the business's owner would get it right now — same frame, same facts card —
 * but with no link behind it: nothing typed here is saved, uploaded or sent, and no link is created or opened.
 */

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Preview: onboarding form", robots: { index: false, follow: false } };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ lang?: string | string[] }> };

export default async function StartPreviewPage({ params, searchParams }: Props) {
  const [{ id }, sp] = await Promise.all([params, searchParams, requireUser()]);
  const db = await getDb();
  const [client] = await db.select().from(schema.clients).where(eq(schema.clients.id, id));
  if (!client || client.kind === "creator") notFound();
  const lang: IntakeLangCode = parseIntakeLang(Array.isArray(sp.lang) ? sp.lang[0] : sp.lang) ?? "en";
  const setup = intakeFormSetup(client, lang);

  return (
    <IntakeShell
      lang={lang}
      rememberLang={false}
      banner={
        <div lang="en" data-intake-preview="" className="notice mb-8">
          <Status tone="info" className="min-w-0 flex-1">
            <span>
              <strong className="font-semibold">Preview.</strong> This is what {client.name}&apos;s owner sees. Nothing you type here is saved or sent.
            </span>
          </Status>
          <Link href={`/clients/${client.id}`} className="link">Back to {client.name}</Link>
        </div>
      }
    >
      <IntakeForm
        preview
        token=""
        intakeId={`preview-${client.id}`}
        lang={lang}
        businessName={client.name}
        initial={setup.initial}
        facts={setup.facts}
        factsKey={setup.factsKey}
        askHandles={setup.askHandles}
        accessEmail={intakeAccessEmail()}
        uploadsEnabled={false}
      />
    </IntakeShell>
  );
}
