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

/** An exact Shortcut action or value: ink and medium inside the muted instructions, nothing drawn around it. */
function A({ children }: { children: ReactNode }) {
  return <span className="font-medium text-text">{children}</span>;
}

/** One step: the numeral in the margin, the step's name, then the instructions in muted text. Steps sit on hairlines. */
function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="grid grid-cols-[1.75rem_minmax(0,1fr)] items-baseline py-3.5">
      <span aria-hidden className="num text-muted">{n}</span>
      <div className="min-w-0">
        <p className="font-medium">{title}</p>
        <div className="mt-1 space-y-1.5 text-muted">{children}</div>
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
    <div className="max-w-2xl">
      <PageHeader crumb={<Link href="/settings">Settings</Link>} title="Quick capture" subtitle="Send an ask from anywhere on your phone: the Share button, Siri, or an app icon." />

      <div className="flex flex-col gap-10 max-md:gap-8">
        <Card title="Your keys">
          <p className="mb-4 text-muted">
            A key lets your iPhone Shortcut send asks as you ({user.email}). Make one per phone; turn it off here if a phone is lost.
          </p>
          <CaptureTokenForm defaultLabel={`${first}'s iPhone`} />
          {tokens.length === 0 ? (
            <div className="mt-4"><EmptyState title="No keys yet">Make one above, then set up the Shortcut below.</EmptyState></div>
          ) : (
            <ul className="list is-ruled mt-6">
              {tokens.map((t) => (
                <li key={t.id} className="row items-center">
                  <div className="min-w-0 flex-1">
                    <p className="row-title truncate">{t.label}</p>
                    <p className="meta whitespace-normal">
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
          <p className="mb-5 text-muted">
            About 5 minutes, once. Afterwards: tap Share → <A>Nora Ask</A> on a photo, link or text, or say “Hey Siri, Nora Ask”.
            (iPhones can’t add web apps to the Share sheet, so a Shortcut does it.)
          </p>
          <div className="mb-5">
            <p className="label">Address the Shortcut sends to</p>
            <div className="flex min-w-0 items-baseline gap-3">
              <code className="min-w-0 flex-1 truncate font-mono text-[0.8125rem]">{endpoint}</code>
              <CopyButton text={endpoint} size="sm" />
            </div>
          </div>
          <ol className="list is-ruled">
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
              <p className="meta">Want a straight-to-Claude option? Add an item <A>Claude</A> with Text <A>claude</A>.</p>
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
          <p className="meta mt-4">
            Photos must be under 4MB each (the resize step takes care of it). Videos: add them from the app instead. Up to 30 sends a minute.
          </p>
        </Card>

        <Card title="One-tap app icon">
          <ol className="ps-steps-list text-muted">
            <li><span aria-hidden className="n">1</span><span>On your iPhone, open <A>{base}/asks/new</A> in Safari (signed in).</span></li>
            <li><span aria-hidden className="n">2</span><span>Tap Share → <A>Add to Home Screen</A> → name it “Nora Ask” → Add.</span></li>
            <li><span aria-hidden className="n">3</span><span>Tapping the icon opens straight into a new ask. (Android/Chrome: ⋮ → Add to Home screen.)</span></li>
          </ol>
        </Card>
      </div>
    </div>
  );
}
