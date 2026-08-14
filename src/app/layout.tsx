import type { Metadata } from "next";
import { DM_Serif_Display, Space_Grotesk } from "next/font/google";
import "./globals.css";

/**
 * Same pairing as the WC2026 app: an editorial serif for display type against
 * a geometric sans for everything else.
 *
 * Loaded through next/font rather than an @import in CSS — the fonts are then
 * self-hosted and preloaded, so headings don't reflow on first paint.
 */
const dmSerif = DM_Serif_Display({
  variable: "--font-dm-serif",
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
  display: "swap",
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Lock Your Picks",
    template: "%s · Lock Your Picks",
  },
  description:
    "Draft three fixtures a week across English football and call the result. Once a fixture is taken in your division, it's gone.",
  // The padlock mark carried over from the WC2026 app — ink and lime.
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
    shortcut: "/favicon.ico",
  },
  openGraph: {
    title: "Lock Your Picks",
    description:
      "Three picks. One draft. No second chances. A weekly football prediction league.",
    type: "website",
  },
};

export const viewport = {
  themeColor: "#0d0d0d",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${dmSerif.variable} ${spaceGrotesk.variable} h-full`}
    >
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
