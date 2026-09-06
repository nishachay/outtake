import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Space_Grotesk } from "next/font/google";

import RootShell from "@/components/shell/RootShell";
import "./globals.css";

const SITE_URL = process.env.SITE_URL || "https://outtake.vercel.app";

const display = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

const body = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "{ OUTTAKE } — Unreleased Music Vault",
    template: "%s — OUTTAKE",
  },
  description:
    "{ OUTTAKE } — Unreleased Music Vault & 3D Vinyl Turntable Player. Only currently-playable, machine-verified unreleased tracks.",
};

const themeScript = `
(function () {
  var t = null;
  try { t = localStorage.getItem('theme'); } catch (e) {}
  if (t !== 'light' && t !== 'dark') t = 'dark';
  document.documentElement.setAttribute('data-theme', t);
})();
`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${display.variable} ${body.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <RootShell>{children}</RootShell>
      </body>
    </html>
  );
}
