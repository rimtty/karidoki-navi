import Link from "next/link";
import {
  PasswordRecoveryRequestForm,
  PasswordUpdateForm,
} from "./auth/password-recovery-form";
import styles from "./auth-login-view.module.css";

type AuthRecoveryViewProps = {
  mode: "request" | "update";
};

export function AuthRecoveryView({ mode }: AuthRecoveryViewProps) {
  const isRequest = mode === "request";

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
          <p className={styles.eyebrow}>ACCOUNT RECOVERY</p>
          <h1>{isRequest ? "パスワード再設定" : "新しいパスワード"}</h1>
          <p>
            {isRequest
              ? "登録したメールアドレスへ、安全な再設定リンクを送ります。"
              : "再設定メールを開いた端末で、新しいパスワードを入力してください。"}
          </p>
        </div>
        {isRequest ? <PasswordRecoveryRequestForm /> : <PasswordUpdateForm />}
      </div>
      <p className={styles.backLink}>
        <Link href="/login">← ログインへ戻る</Link>
      </p>
    </main>
  );
}
