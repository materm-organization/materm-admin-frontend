import type { Metadata } from "next";
import { Geist, Geist_Mono, Noto_Sans_Lao_Looped } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { headers } from "next/headers";

import { QueryProvider } from "@/components/provider/query-provider";
import { ReduxProvider } from "@/components/provider/redux-provider";
import { ThemeProvider } from "@/components/provider/theme-provider";
import { Toaster } from "@/components/ui/sonner";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Non-Latin-script locales need their own font, loaded conditionally —
// Latin-script locales fall back to Geist above.
// This project uses `la` (Lao) as its non-Latin locale; to support another
// one, load its font the same way here and extend the
// `locale === "la" ? ... : ...` branch below into a small lookup.
//
// `subsets` only controls which font files next/font preloads at build
// time ("latin" only). Lao glyphs still load on demand via unicode-range, but
// since `la` is now the default locale, the Lao glyphs aren't preloaded,
// so the very first paint may briefly show a fallback font before the Lao
// webfont file arrives. Add "lao" to this array to preload it if that
// matters for this product.
const notoSansLao = Noto_Sans_Lao_Looped({
  variable: "--font-noto-sans-lao",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Materm Admin",
  description: "Materm Admin back-office panel.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  // Per-request CSP nonce set by src/proxy.ts; next-themes' inline script needs it.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const fontClassName = locale === "la" ? notoSansLao.className : geistSans.className;

  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${notoSansLao.variable}`}
    >
      <body className={`${fontClassName} antialiased`} suppressHydrationWarning>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
          nonce={nonce}
        >
          <NextIntlClientProvider messages={messages}>
            <ReduxProvider>
              <QueryProvider>
                {children}
                <Toaster />
              </QueryProvider>
            </ReduxProvider>
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
