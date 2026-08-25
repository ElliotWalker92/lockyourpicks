import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Archivo, Inter } from "next/font/google";
import "./globals.css";

/**
 * Broadcast-sports typography: a heavy grotesk for display against a neutral
 * UI face, the way FotMob and the Premier League set their scoreboards. The
 * editorial serif that came from the WC2026 app read as a magazine, not a
 * results service, and its italic did most of the talking.
 *
 * Archivo goes to 800 and stays legible tightly tracked at large sizes; Inter
 * carries the tables, where its tabular figures keep columns of scores from
 * shifting as the digits change.
 *
 * Loaded through next/font rather than an @import in CSS — the fonts are then
 * self-hosted and preloaded, so headings don't reflow on first paint.
 */
const archivo = Archivo({
  variable: "--font-archivo",
  weight: ["600", "700", "800"],
  subsets: ["latin"],
  display: "swap",
});

const inter = Inter({
  variable: "--font-inter",
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

/**
 * The theme is rendered, not scripted.
 *
 * Reading a cookie on the server and stamping `data-theme` into the HTML
 * means the first paint is already the right palette. The usual alternative
 * — an inline script that reads localStorage — cannot be placed in an App
 * Router layout without either being a script tag React refuses to execute
 * on navigation, or being hoisted somewhere `<script>` isn't legal.
 *
 * No cookie means no attribute, and the root's `color-scheme: light dark`
 * hands the decision to the operating system with no JavaScript at all.
 */
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const theme = (await cookies()).get("theme")?.value;
  const pinned = theme === "light" || theme === "dark" ? theme : undefined;

  return (
    <html
      lang="en"
      data-theme={pinned}
      className={`${archivo.variable} ${inter.variable} h-full`}
    >
      <body className="flex min-h-full flex-col">
        {children}
      </body>
    </html>
  );
}
