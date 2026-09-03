"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useState } from "react";
import { LogoutButton } from "@/features/auth/logout-button";
import type { AuthenticatedAccountSummary } from "@/lib/auth/account";
import styles from "./app-shell.module.css";

const navigation = [
  { href: "/app", label: "田んぼ", glyph: "▤", match: (path: string) => path === "/app" || /^\/app\/fields\/[^/]+$/.test(path) },
  { href: "/app/fields/new/1", label: "登録", glyph: "+", match: (path: string) => path.startsWith("/app/fields/new") },
  {
    href: "/app/guide",
    label: "使い方",
    glyph: "？",
    match: (path: string) => path.startsWith("/app/guide"),
  },
  {
    href: "/app/settings/variety-rules",
    label: "設定",
    glyph: "⚙",
    match: (path: string) => path.startsWith("/app/settings/variety-rules"),
  },
];

export function AppShell({
  children,
  account,
}: {
  children: ReactNode;
  account: AuthenticatedAccountSummary | null;
}) {
  const pathname = usePathname();
  const [avatarFailed, setAvatarFailed] = useState(false);
  const avatarUrl = avatarFailed ? null : account?.avatarUrl;

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
            <summary
              className={styles.accountButton}
              aria-label={avatarUrl ? "Googleアカウントメニュー" : "アカウントメニュー"}
            >
              {avatarUrl ? (
                // The URL is restricted to Google's HTTPS image host before reaching this component.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  className={styles.accountAvatar}
                  src={avatarUrl}
                  alt=""
                  referrerPolicy="no-referrer"
                  onError={() => setAvatarFailed(true)}
                />
              ) : (
                <span aria-hidden="true">○</span>
              )}
            </summary>
            <div className={styles.accountPanel}>
              <p>ログイン中のアカウント</p>
              {account?.email && <strong>{account.email}</strong>}
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
