"use client";

import Link from "next/link";
import { LoginForm } from "./auth/login-form";
import styles from "./auth-login-view.module.css";

type AuthLoginViewProps = {
  nextPath?: string;
  initialError?: string | null;
  initialMessage?: string | null;
};

export function AuthLoginView({
  nextPath = "/app",
  initialError = null,
  initialMessage = null,
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
          <p className={styles.eyebrow}>WELCOME BACK</p>
          <h1>ログイン</h1>
          <p>メールアドレスまたはGoogleアカウントでログインできます。</p>
        </div>

        <LoginForm
          nextPath={nextPath}
          initialError={initialError}
          initialMessage={initialMessage}
        />
      </div>
      <p className={styles.backLink}>
        <Link href="/">← 紹介ページへ戻る</Link>
      </p>
    </main>
  );
}
