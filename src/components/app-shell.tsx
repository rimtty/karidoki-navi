"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { LogoutButton } from "@/features/auth/logout-button";
import styles from "./app-shell.module.css";

const navigation = [
  { href: "/app", label: "田んぼ", glyph: "▤", match: (path: string) => path === "/app" || /^\/app\/fields\/[^/]+$/.test(path) },
  { href: "/app/fields/new/1", label: "登録", glyph: "+", match: (path: string) => path.startsWith("/app/fields/new") },
  {
    href: "/app/settings/variety-rules",
    label: "設定",
    glyph: "⚙",
    match: (path: string) => path.startsWith("/app/settings/variety-rules"),
  },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/app" aria-label="刈りどきナビ 田んぼ一覧へ">
          <span className={styles.brandMark} aria-hidden="true">
            🌾
          </span>
          <span>刈りどきナビ</span>
        </Link>
        <div className={styles.headerMeta}>
          <details className={styles.accountMenu}>
            <summary className={styles.accountButton} aria-label="アカウントメニュー">
              <span aria-hidden="true">○</span>
            </summary>
            <div className={styles.accountPanel}>
              <p>ログイン中のアカウント</p>
              <LogoutButton />
            </div>
          </details>
        </div>
      </header>

      <main className={styles.content}>{children}</main>

      <nav className={styles.bottomNav} aria-label="メインナビゲーション">
        {navigation.map((item) => {
          const isActive = item.match(pathname);
          return (
            <Link
              className={`${styles.navItem} ${isActive ? styles.active : ""}`}
              href={item.href}
              key={item.href}
              aria-current={isActive ? "page" : undefined}
            >
              <span className={styles.navGlyph} aria-hidden="true">
                {item.glyph}
              </span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
