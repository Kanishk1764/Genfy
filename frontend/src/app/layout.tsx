import type { Metadata } from "next";
import { Geist, Geist_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { Providers } from "@/app/providers";
import { Toaster } from "sonner";
import type { CSSProperties } from "react";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Genfy",
  description: "AI image generation studio",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const fontVars = {
    "--font-space-grotesk": spaceGrotesk.style.fontFamily,
    "--font-geist-sans": geistSans.style.fontFamily,
    "--font-geist-mono": geistMono.style.fontFamily,
  } as CSSProperties;

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${spaceGrotesk.variable}`}
    >
      <body
        className={`${geistSans.className} ${geistSans.variable} ${geistMono.variable} ${spaceGrotesk.variable} antialiased`}
        style={fontVars}
      >
        <Toaster position="top-center" richColors />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
