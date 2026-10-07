import type { Metadata } from "next";
import { Fraunces, JetBrains_Mono, Instrument_Sans } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { Chrome } from "@/components/Chrome";

const display = Fraunces({ subsets: ["latin"], variable: "--font-display", axes: ["opsz", "SOFT"] });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });
const sans = Instrument_Sans({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = { title: "VeriFact", description: "Evidence-grounded verification of claims and media." };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" className={`${display.variable} ${mono.variable} ${sans.variable}`} suppressHydrationWarning>
      <body className="min-h-screen font-sans antialiased">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[70] focus:bg-signal focus:px-3 focus:py-2 focus:text-ink">Skip to content</a>
        <Chrome />
        <main id="main" className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">{children}</main>
        <footer className="mx-auto max-w-6xl border-t border-line px-4 py-8 text-sm text-dim sm:px-6">
          <p className="max-w-2xl">Uploaded media is deleted after the retention window and is never used for training. VeriFact reports evidence, not certainty: read <Link className="underline" href="/limitations">known limitations</Link>.</p>
        </footer>
      </body>
    </html>
  );
}
