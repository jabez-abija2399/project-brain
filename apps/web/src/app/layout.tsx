import { Geist, Geist_Mono } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";
import "./landing.css";

// FEAT-040 (design v3): Geist for the interface, Geist Mono for receipts, paths and codes. next/font downloads the
// files at build time and serves them from this site, so a visitor's browser never asks another site for a font.
const ui = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

export const metadata = {
  title: "Codeceipt",
  description: "A receipt for every AI change.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${ui.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
