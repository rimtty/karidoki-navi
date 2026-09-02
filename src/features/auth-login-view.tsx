"use client";

import Link from "next/link";
import { useState } from "react";
import styles from "./auth-login-view.module.css";

export function AuthLoginView() {
  const [message, setMessage] = useState<string | null>(null);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("認証接続は準備中です。入力内容は送信されていません。");
  }

  function handleGoogle() {
    setMessage("Googleログイン接続は準備中です。");
  }

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
          <p>圃場の刈りどきを確認するにはログインしてください。</p>
        </div>

        <div className={styles.devNotice} role="note">
          <span aria-hidden="true">DEV</span>
          <p>認証は開発プレビューです。実際のアカウント接続は未実装です。</p>
        </div>

        {message && (
          <div className={styles.message} role="status">
            <span aria-hidden="true">i</span>
            <p>{message}</p>
          </div>
        )}

        <button className={styles.googleButton} type="button" onClick={handleGoogle}>
          <span className={styles.googleGlyph} aria-hidden="true">G</span>
          Googleでログイン
        </button>

        <div className={styles.divider}>
          <span>または</span>
        </div>

        <form className={styles.form} onSubmit={handleSubmit}>
          <label>
            <span>メールアドレス</span>
            <input type="email" name="email" autoComplete="email" placeholder="name@example.com" required />
          </label>
          <label>
            <span>パスワード</span>
            <input type="password" name="password" autoComplete="current-password" placeholder="••••••••" required />
          </label>
          <button className={styles.submitButton} type="submit">
            メールアドレスでログイン
          </button>
        </form>

        <p className={styles.accountPrompt}>
          アカウントをお持ちでない方は <Link href="/login">新規登録（準備中）</Link>
        </p>
      </div>
      <p className={styles.backLink}>
        <Link href="/">← 紹介ページへ戻る</Link>
      </p>
    </main>
  );
}
