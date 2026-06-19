import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Space_Grotesk } from "next/font/google";
import "./globals.css";

// Display face for headlines and the big capital figure. Exposed as a CSS
// variable; every component that uses it falls back to the system stack, so the
// app renders correctly even if this file isn't deployed.
const display = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Franchise Edge — FDD Diligence",
  description: "Turn a 300-page FDD into a clear, scored diligence read — measured against your own capital.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={display.variable}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
