import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Nora HQ", template: "%s · Nora HQ" },
  description: "Private ops tracker for Nora's social clients",
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: "Nora HQ", statusBarStyle: "default" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#c2410c" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
