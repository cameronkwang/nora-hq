import Link from "next/link";
import type { ReactNode } from "react";
import { assigneeFor, requireUser } from "@/lib/auth";
import { relativeTime } from "@/lib/dates";
import { appUrl } from "@/lib/integrations/oauth";
import { listCaptureTokens } from "@/lib/ops-capture";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { ConfirmButton } from "@/components/client-form";
import { CopyButton } from "@/components/copy-button";
import { CaptureTokenForm } from "@/components/capture-token-form";
import { revokeCaptureTokenAction } from "./actions";

export const dynamic = "force-dynamic";

/** Monospace chip for an exact Shortcut action / value. */
function A({ children }: { children: ReactNode }) {
  return <span className="rounded bg-surface-2 px-1.5 py-0.5 font-medium text-text">{children}</span>;
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent">{n}</span>
      <div className="min-w-0 flex-1 pb-1">
        <p className="font-medium">{title}</p>
        <div className="mt-1 space-y-1.5 text-sm text-muted">{children}</div>
      </div>
    </li>
  );
}

export default async function CaptureSettingsPage() {
  const user = await requireUser();
  const tokens = await listCaptureTokens(user.email);
  const base = appUrl() ?? "https://<your Nora HQ address>";
  const endpoint = `${base}/api/asks/capture`;
  const first = user.name.split(" ")[0];
  const other = assigneeFor(user) === "cameron" ? "Nora" : "Cameron";

  return (
    <div className="mx-auto max-w-2xl">
      <p className="mb-2 text-sm"><Link href="/settings" className="text-muted hover:underline">← Settings</Link></p>
      <PageHeader title="Quick capture" subtitle="Send an ask from anywhere on your phone — the Share button, Siri, or an app icon." />

      <div className="flex flex-col gap-6">
        <Card title="Your keys">
          <p className="mb-3 text-sm text-muted">
            A key lets your iPhone Shortcut send asks as you ({user.email}). Make one per phone; turn it off here if a phone is lost.
          </p>
          <CaptureTokenForm defaultLabel={`${first}'s iPhone`} />
          {tokens.length === 0 ? (
            <div className="mt-4"><EmptyState title="No keys yet">Make one above, then set up the Shortcut below.</EmptyState></div>
          ) : (
            <ul className="mt-4 divide-y divide-border border-t border-border">
              {tokens.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{t.label}</p>
                    <p className="text-xs text-muted">
                      Made {relativeTime(t.createdAt)} · {t.lastUsedAt ? `last used ${relativeTime(t.lastUsedAt)}` : "not used yet"}
                    </p>
                  </div>
                  <form action={revokeCaptureTokenAction}>
                    <input type="hidden" name="id" value={t.id} />
                    <ConfirmButton confirm={`Turn off “${t.label}”? The Shortcut on that phone will stop working.`}>Turn off</ConfirmButton>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Install the iPhone Shortcut">
          <p className="mb-4 text-sm text-muted">
            About 5 minutes, once. Afterwards: tap Share → <A>Nora Ask</A> on a photo, link or text — or say “Hey Siri, Nora Ask”.
            (iPhones can’t add web apps to the Share sheet, so a Shortcut does it.)
          </p>
          <div className="mb-4">
            <p className="label">Address the Shortcut sends to</p>
            <div className="flex min-w-0 items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg bg-surface-2 px-3 py-2 text-xs">{endpoint}</code>
              <CopyButton text={endpoint} size="sm" />
            </div>
          </div>
          <ol className="flex flex-col gap-4">
            <Step n={1} title="Create it">
              <p>Open the <A>Shortcuts</A> app → <A>+</A>. Name it <A>Nora Ask</A> (that’s also what you say to Siri).</p>
            </Step>
            <Step n={2} title="Turn on the Share sheet">
              <p>Tap <A>ⓘ</A> (or the name at the top → Details) → turn on <A>Show in Share Sheet</A>.</p>
              <p>In the first action, set <A>Receive Text, URLs, Images and Safari web pages from Share Sheet</A>, and <A>If there’s no input: Continue</A>.</p>
            </Step>
            <Step n={3} title="If there’s nothing shared, listen instead">
              <p>Add <A>If</A> → <A>Shortcut Input</A> <A>does not have any value</A>.</p>
              <p>Inside it: <A>Dictate Text</A> (Stop listening: After Pause) → <A>Set Variable</A> <A>Note</A> to <A>Dictated Text</A>.</p>
              <p>Under <A>Otherwise</A>: <A>Set Variable</A> <A>Note</A> to <A>Shortcut Input</A>. Leave <A>End If</A>.</p>
            </Step>
            <Step n={4} title="Ask who it’s for">
              <p>Add <A>Choose from Menu</A> with prompt “Who’s it for?” and four items: <A>Claude decides</A> <A>{other}</A> <A>Ad hoc task</A> <A>Idea</A>.</p>
              <p>Under each item add a <A>Text</A> action with exactly: <A>auto</A>, <A>{other.toLowerCase()}</A>, <A>adhoc</A>, <A>idea</A>.</p>
              <p>After <A>End Menu</A>: <A>Set Variable</A> <A>Route</A> to <A>Menu Result</A>.</p>
              <p className="text-xs">Want a straight-to-Claude option? Add an item <A>Claude</A> with Text <A>claude</A>.</p>
            </Step>
            <Step n={5} title="Photos: shrink first">
              <p>Add <A>Get Type of</A> <A>Note</A>, then <A>If</A> <A>Type</A> <A>is</A> <A>Image</A>:</p>
              <p><A>Resize Image</A> <A>Note</A> to width <A>1600</A> (height Auto) → <A>Convert</A> to <A>JPEG</A>.</p>
            </Step>
            <Step n={6} title="Send it (photo)">
              <p>Still inside that If: <A>Get Contents of URL</A> → the address above.</p>
              <p>Tap <A>Show More</A>: Method <A>POST</A>; Headers → <A>Authorization</A> = <A>Bearer nhq_…</A> (the word Bearer, a space, then your key); Request Body <A>Form</A> with fields:</p>
              <p><A>route</A> (Text) = <A>Route</A> · <A>file</A> (File) = <A>Converted Image</A> · optional <A>text</A> (Text).</p>
            </Step>
            <Step n={7} title="Send it (text or link)">
              <p>Under <A>Otherwise</A>: <A>Get URLs from</A> <A>Note</A>, then <A>Get Contents of URL</A> → same address, Method <A>POST</A>, same Authorization header, Request Body <A>JSON</A>:</p>
              <p><A>text</A> (Text) = <A>Note</A> · <A>url</A> (Text) = <A>URLs</A> · <A>route</A> (Text) = <A>Route</A>.</p>
              <p>Leave <A>End If</A>.</p>
            </Step>
            <Step n={8} title="Show the answer">
              <p>Add <A>Get Dictionary Value</A> <A>message</A> from <A>If Result</A> (or Contents of URL) → <A>Show Notification</A> <A>Dictionary Value</A>.</p>
              <p>You’ll see “Sent to Claude ✓”, “Task added for {other} ✓” and so on.</p>
            </Step>
            <Step n={9} title="Try it">
              <p>In Safari, tap Share → <A>Nora Ask</A>. Or say “Hey Siri, Nora Ask”. It shows up on Home and in Asks right away.</p>
            </Step>
          </ol>
          <p className="mt-4 text-xs text-muted">
            Photos must be under 4MB each (the resize step takes care of it). Videos: add them from the app instead. Up to 30 sends a minute.
          </p>
        </Card>

        <Card title="One-tap app icon">
          <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted">
            <li>On your iPhone, open <span className="font-medium text-text">{base}/asks/new</span> in Safari (signed in).</li>
            <li>Tap Share → <span className="font-medium text-text">Add to Home Screen</span> → name it “Nora Ask” → Add.</li>
            <li>Tapping the icon opens straight into a new ask. (Android/Chrome: ⋮ → Add to Home screen.)</li>
          </ol>
        </Card>
      </div>
    </div>
  );
}
