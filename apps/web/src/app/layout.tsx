import type { ReactNode } from "react";
import "./globals.css";
import "./landing.css";

export const metadata = {
  title: "Codeceipt",
  description: "A receipt for every AI change.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
