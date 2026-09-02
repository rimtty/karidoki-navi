import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { PwaStatus } from "@/components/pwa-status";
import "./globals.css";

export const metadata: Metadata = {
  applicationName: "刈りどきナビ",
  title: {
    default: "刈りどきナビ",
    template: "%s | 刈りどきナビ",
  },
  description:
    "田んぼの積算気温を自動計算し、次に刈る田んぼがひと目で分かるWebアプリ",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      {
        url: "/icons/icon-192.png",
        type: "image/png",
        sizes: "192x192",
      },
      {
        url: "/icons/icon-512.png",
        type: "image/png",
        sizes: "512x512",
      },
    ],
    apple: {
      url: "/icons/icon-192.png",
      type: "image/png",
      sizes: "192x192",
    },
  },
  appleWebApp: {
    capable: true,
    title: "刈りどきナビ",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#315c2b",
  colorScheme: "light",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ja">
      <body>
        <PwaStatus />
        {children}
      </body>
    </html>
  );
}
