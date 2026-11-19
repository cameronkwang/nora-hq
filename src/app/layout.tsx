import type { Metadata, Viewport } from "next";
// The display serif (page and section titles), self-hosted: Next serves the woff2 from this app, nothing is fetched
// from a third party at runtime. The sans is the device's own UI font.
import "@fontsource-variable/newsreader/opsz.css";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Nora HQ", template: "%s · Nora HQ" },
  description: "Private ops tracker for Nora's social clients",
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: "Nora HQ", statusBarStyle: "default" },
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }, { url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icon-180.png", sizes: "180x180" }],
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Lets the app draw edge to edge on notched phones; the shell pads with env(safe-area-inset-*).
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfaf7" },
    { media: "(prefers-color-scheme: dark)", color: "#131311" },
  ],
};

/**
 * Applies a saved Light / Dark choice before the first paint, so there's no flash of the wrong theme.
 * "Auto" (nothing saved) follows the phone's own setting. Kept tiny and dependency-free on purpose.
 */
const THEME_SCRIPT = `try{var t=localStorage.getItem("nora-hq:theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
