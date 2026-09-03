"use client";

import Link from "next/link";
import { LoginForm } from "./auth/login-form";
import { LogoutButton } from "./auth/logout-button";
import type { AuthenticatedAccountSummary } from "@/lib/auth/account";
import styles from "./auth-login-view.module.css";

type AuthLoginViewProps = {
  nextPath?: string;
  initialError?: string | null;
  initialMessage?: string | null;
  authenticatedAccount?: AuthenticatedAccountSummary | null;
};

export function AuthLoginView({
  nextPath = "/app",
  initialError = null,
  initialMessage = null,
  authenticatedAccount = null,
}: AuthLoginViewProps) {
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <Link className={styles.brand} href="/" aria-label="刈りどきナビの紹介へ戻る">
          <span className={styles.brandMark} aria-hidden="true">
            🌾
          </span>
          <span>刈りどきナビ</span>
        </Link>
        <div className={styles.heading}>
          <p className={styles.eyebrow}>
            {authenticatedAccount ? "ログイン状態" : "おかえりなさい"}
          </p>
          <h1>{authenticatedAccount ? "ログイン済みです" : "ログイン"}</h1>
          <p>
            {authenticatedAccount
              ? "すでに認証済みのため、新規登録フォームは表示していません。"
              : "メールアドレスまたはGoogleアカウントでログインできます。"}
          </p>
        </div>

        {authenticatedAccount ? (
          <div className={styles.signedInSection}>
            <div className={styles.signedInNotice} role="status">
              <span className={styles.providerMark} aria-hidden="true">
                {authenticatedAccount.currentProvider === "google" ? "G" : "✓"}
              </span>
              <div>
                <strong>
                  {authenticatedAccount.currentProvider === "google"
                    ? "Googleアカウントでログイン済みです"
                    : authenticatedAccount.hasGoogleIdentity
                      ? "Googleログインも登録済みのアカウントです"
                      : "メールアドレスでログイン済みです"}
                </strong>
                {authenticatedAccount.email && <p>{authenticatedAccount.email}</p>}
                {authenticatedAccount.hasGoogleIdentity && (
                  <p>このメールアドレスは、すでにGoogleアカウントで登録済みです。</p>
                )}
              </div>
            </div>
            <div className={styles.signedInActions}>
              <Link className={styles.appLink} href={nextPath}>
                アプリへ戻る
              </Link>
              <LogoutButton />
            </div>
          </div>
        ) : (
          <LoginForm
            nextPath={nextPath}
            initialError={initialError}
            initialMessage={initialMessage}
          />
        )}
      </div>
      <p className={styles.backLink}>
        <Link href="/">← 紹介ページへ戻る</Link>
      </p>
    </main>
  );
}
