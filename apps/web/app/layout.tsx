import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";
import { ThemeScript } from "@/components/ThemeToggle";

/* Display — used only on the landing surface, and sparingly even there. */
const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-bricolage",
  display: "swap",
});

/* Body — IBM Plex carries genuine instrumentation heritage, and is not the
   reflexive Inter default. */
const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-sans",
  display: "swap",
});

/* Data — patient refs, probabilities, coverage figures. Radiology runs on
   alphanumeric codes, so mono here is truthful rather than decorative. */
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "SENTINEL-CXR — Uncertainty-Aware Chest Radiograph Triage",
  description:
    "A chest radiograph triage system that produces calibrated prediction sets and abstains when it cannot meet its coverage guarantee. Research prototype, MAIB AI 114.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0b0d0e" },
    { media: "(prefers-color-scheme: light)", color: "#f7f8f9" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${bricolage.variable} ${plexSans.variable} ${plexMono.variable}`}
    >
      <head>
        <ThemeScript />
      </head>
      <body>{children}</body>
    </html>
  );
}
