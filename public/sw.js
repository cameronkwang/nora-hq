/* Nora HQ service worker — phone notifications only (no offline caching, no fetch handler). */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Nora HQ";
  const url = typeof data.url === "string" && data.url.startsWith("/") ? data.url : "/";
  // iOS requires every push to show a notification, so always show one.
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: data.tag || undefined,
      renotify: !!data.tag,
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const w of wins) {
        if (new URL(w.url).origin !== self.location.origin) continue;
        try {
          await w.focus();
          if ("navigate" in w) await w.navigate(target);
          return;
        } catch (e) {
          /* fall through to opening a new window */
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});

// The browser rotated the subscription: save the new one (the session cookie goes along, same origin).
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const old = event.oldSubscription;
        const sub = event.newSubscription || (old && (await self.registration.pushManager.subscribe(old.options)));
        if (!sub) return;
        await fetch("/api/push/subscribe", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subscription: sub.toJSON() }),
        });
        if (old) {
          await fetch("/api/push/unsubscribe", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ endpoint: old.endpoint }),
          });
        }
      } catch (e) {
        /* next visit to Settings → Notifications re-subscribes */
      }
    })(),
  );
});
