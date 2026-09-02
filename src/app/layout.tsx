import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
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
};

export const viewport: Viewport = {
  themeColor: "#315c2b",
  colorScheme: "light",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
