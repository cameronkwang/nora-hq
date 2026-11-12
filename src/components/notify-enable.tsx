"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, cx } from "./ui";

/* ───────────────────────── Browser helpers (shared by notify-* components) ───────────────────────── */

export type PushEnv = "loading" | "ios-install" | "unsupported" | "ready";

export function isIos() {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function isStandalone() {
  try {
    return (navigator as Navigator & { standalone?: boolean }).standalone === true || window.matchMedia("(display-mode: standalone)").matches;
  } catch {
    return false;
  }
}

export function pushEnv(): Exclude<PushEnv, "loading"> {
  if (isIos() && !isStandalone()) return "ios-install"; // iOS only allows web push from a Home Screen app
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  return "ready";
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  try {
    const reg = await navigator.serviceWorker.getRegistration("/");
    return (await reg?.pushManager.getSubscription()) ?? null;
  } catch {
    return null;
  }
}

/** Same as the server's sha256(endpoint) prefix (ops-notify listPushDevices). */
export async function endpointKey(endpoint: string): Promise<string | null> {
  try {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
  } catch {
    return null;
  }
}

function keyBytes(base64url: string) {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, data };
}

/* ───────────────────────── Add to Home Screen steps (iOS) ───────────────────────── */

export function IosInstallSteps() {
  return (
    <div className="rounded-lg border border-border bg-surface-2 p-3 text-sm">
      <p className="font-medium">Add Nora HQ to your Home Screen first</p>
      <p className="mt-1 text-muted">iPhones only send notifications to web apps opened from the Home Screen.</p>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted">
        <li>In Safari, tap the Share button <span aria-hidden>(□↑)</span>.</li>
        <li>Tap <span className="font-medium text-text">Add to Home Screen</span> → <span className="font-medium text-text">Add</span>.</li>
        <li>Open Nora HQ from the new icon, then come back to Settings → Notifications.</li>
      </ol>
    </div>
  );
}

/* ───────────────────────── This device: turn on / off / test ───────────────────────── */

type State = "loading" | "ios-install" | "unsupported" | "denied" | "off" | "on" | "busy";

/**
 * Turns notifications on for the current device. Permission is requested only when the person taps the button
 * (iOS requires a tap). `deviceKeys` are the endpoint keys the server knows for this person, so a device removed
 * on the server shows as off here.
 */
export function NotifyEnable({ publicKey, deviceKeys, compact = false }: { publicKey: string | null; deviceKeys: string[]; compact?: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<State>("loading");
  const [msg, setMsg] = useState<{ tone: "ok" | "danger" | "muted"; text: string } | null>(null);
  const keysSig = deviceKeys.join(",");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const env = pushEnv();
      if (env !== "ready") return !cancelled && setState(env);
      if (Notification.permission === "denied") return !cancelled && setState("denied");
      const sub = await currentSubscription();
      const key = sub ? await endpointKey(sub.endpoint) : null;
      if (!cancelled) setState(sub && Notification.permission === "granted" && key && keysSig.split(",").includes(key) ? "on" : "off");
    })();
    return () => {
      cancelled = true;
    };
  }, [keysSig]);

  async function turnOn() {
    setMsg(null);
    if (!publicKey) return setMsg({ tone: "danger", text: "Notifications aren't set up on the server yet (VAPID keys missing)." });
    setState("busy");
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setState(perm === "denied" ? "denied" : "off");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
      const r = await postJson("/api/push/subscribe", { subscription: sub.toJSON() });
      if (!r.ok) throw new Error(String(r.data.error ?? "Couldn't save this device"));
      setState("on");
      setMsg({ tone: "ok", text: "Notifications are on for this device." });
      router.refresh();
    } catch (e) {
      setState("off");
      setMsg({ tone: "danger", text: `Couldn't turn on notifications: ${(e as Error).message || "unknown error"}` });
    }
  }

  async function turnOff() {
    setMsg(null);
    setState("busy");
    try {
      const sub = await currentSubscription();
      if (sub) {
        await postJson("/api/push/unsubscribe", { endpoint: sub.endpoint });
        await sub.unsubscribe().catch(() => false);
      }
      setState("off");
      router.refresh();
    } catch {
      setState("on");
      setMsg({ tone: "danger", text: "Couldn't turn off notifications. Try again." });
    }
  }

  async function test() {
    setMsg({ tone: "muted", text: "Sending…" });
    try {
      const r = await postJson("/api/push/test", {});
      const sent = Number(r.data.sent ?? 0);
      if (r.data.skipped === "not_configured") setMsg({ tone: "danger", text: "Server isn't set up for notifications (VAPID keys missing)." });
      else if (sent > 0) setMsg({ tone: "ok", text: `Sent to ${sent} device${sent === 1 ? "" : "s"} — it should pop up in a few seconds.` });
      else setMsg({ tone: "danger", text: "No device got it. Turn notifications off and on again on this device." });
    } catch {
      setMsg({ tone: "danger", text: "Couldn't send a test." });
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {state === "loading" && <p className="text-sm text-muted">Checking this device…</p>}
      {state === "ios-install" && <IosInstallSteps />}
      {state === "unsupported" && <p className="text-sm text-muted">This browser can&apos;t show notifications. On iPhone, use Safari and add Nora HQ to your Home Screen.</p>}
      {state === "denied" && (
        <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
          Notifications are blocked for Nora HQ. On iPhone: Settings → Notifications → Nora HQ → Allow. On a computer: click the lock icon next to the address and allow notifications, then reload.
        </p>
      )}
      {(state === "off" || state === "on" || state === "busy") && (
        <div className="flex flex-wrap items-center gap-2">
          {state === "on" ? (
            <>
              <span className="text-sm font-medium text-ok">On for this device ✓</span>
              <Button size="md" onClick={test}>Send test</Button>
              {!compact && <Button size="md" variant="ghost" onClick={turnOff}>Turn off here</Button>}
            </>
          ) : (
            <Button variant="primary" size="md" onClick={turnOn} disabled={state === "busy"}>
              {state === "busy" ? "Turning on…" : "Turn on notifications"}
            </Button>
          )}
        </div>
      )}
      {msg && (
        <p role="status" aria-live="polite" className={cx("text-sm", msg.tone === "ok" ? "text-ok" : msg.tone === "danger" ? "text-danger" : "text-muted")}>
          {msg.text}
        </p>
      )}
    </div>
  );
}
