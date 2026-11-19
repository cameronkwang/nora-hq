import type { Metadata, Viewport } from "next";
// The display serif (page and section titles), self-hosted: Next serves the woff2 from this app, nothing is fetched
// from a third party at runtime. The sans is the device's own UI font.
import "@fontsource-variable/newsreader/opsz.css";
import "./globals.css";
import { THEME_BG, THEME_KEY } from "@/lib/theme";

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
    { media: "(prefers-color-scheme: light)", color: THEME_BG.light },
    { media: "(prefers-color-scheme: dark)", color: THEME_BG.dark },
  ],
};

/**
 * Runs before the first paint, on every page (the owner forms too). Kept tiny and dependency-free on purpose.
 * 1. Applies a saved Light / Dark choice, so there's no flash of the wrong theme. "Auto" (nothing saved) follows the
 *    phone's own setting.
 * 2. The phone's browser and status bar follow the choice too: every theme-color meta takes the chosen palette's
 *    background, or on Auto its own media query's color. Next renders those metas after this script and again on
 *    navigation, so a watcher on <head> (and on <html data-theme>, which ThemeChoice changes) keeps them in step.
 * 3. Keyboard focus in a sideways strip (tab and chip rows) or on a tall textarea: Chrome leaves an element that is
 *    already partly on screen where it is, so a chip can sit half off the edge and a textarea under the phone tab bar.
 *    Bring the whole thing into view; scroll-padding (globals.css) keeps it clear of the edge and the bars. Only for
 *    keyboard focus on links and buttons (a click never scrolls the strip under the pointer).
 */
const THEME_SCRIPT = `(function(){var R=document.documentElement,BG=${JSON.stringify(THEME_BG)};
try{var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(t==="light"||t==="dark")R.dataset.theme=t}catch(e){}
try{var tc=function(){var d=R.dataset.theme,c=d==="light"||d==="dark"?BG[d]:null;document.querySelectorAll('meta[name="theme-color"]').forEach(function(m){var v=c||(m.media.indexOf("dark")>-1?BG.dark:BG.light);if(m.getAttribute("content")!==v)m.setAttribute("content",v)})};
new MutationObserver(tc).observe(document.head,{childList:true,subtree:true,attributes:true,attributeFilter:["content"]});
new MutationObserver(tc).observe(R,{attributes:true,attributeFilter:["data-theme"]});tc()}catch(e){}
document.addEventListener("focusin",function(e){try{var el=e.target;if(!(el instanceof Element)||!el.closest(".overflow-x-auto,.overflow-x-scroll,.board-tabs,textarea"))return;if(el.tagName!=="TEXTAREA"&&!el.matches(":focus-visible"))return;el.scrollIntoView({block:"nearest",inline:"nearest"})}catch(x){}})})();`;

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
