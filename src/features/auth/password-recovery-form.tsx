"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState } from "react";
import { getAuthErrorMessage } from "./auth-errors";
import { createClient } from "@/lib/supabase/client";
import styles from "./password-recovery-form.module.css";

function getResetCallbackUrl(): string {
  const callbackUrl = new URL("/auth/callback", window.location.origin);
  callbackUrl.searchParams.set("next", "/reset-password");
  return callbackUrl.toString();
}

export function PasswordRecoveryRequestForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const pendingRef = useRef(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRef.current) return;

    const normalizedEmail = email.trim();
    if (!normalizedEmail || !normalizedEmail.includes("@")) {
      setError("メールアドレスの形式を確認してください。");
      return;
    }

    pendingRef.current = true;
    setIsPending(true);
    setError(null);
    setMessage(null);

    try {
      const { error: recoveryError } =
        await createClient().auth.resetPasswordForEmail(normalizedEmail, {
          redirectTo: getResetCallbackUrl(),
        });

      if (recoveryError) {
        setError(getAuthErrorMessage(recoveryError, "recovery_request"));
        return;
      }

      // Keep this response account-enumeration safe: Supabase returns the same
      // success shape whether or not the address is registered.
      setMessage(
        "登録済みのメールアドレスであれば、パスワード再設定メールが届きます。",
      );
    } catch (caughtError) {
      setError(
        getAuthErrorMessage(
          caughtError instanceof Error ? { message: caughtError.message } : null,
          "recovery_request",
        ),
      );
    } finally {
      pendingRef.current = false;
      setIsPending(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      {error && (
        <p className={styles.error} role="alert" aria-live="assertive">
          {error}
        </p>
      )}
      {message && (
        <p className={styles.message} role="status" aria-live="polite">
          {message}
        </p>
      )}
      <label className={styles.field} htmlFor="recovery-email">
        メールアドレス
      </label>
      <input
        className={styles.input}
        id="recovery-email"
        name="email"
        type="email"
        inputMode="email"
        autoComplete="email"
        placeholder="name@example.com"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        disabled={isPending}
        required
      />
      <button className={styles.submitButton} type="submit" disabled={isPending}>
        {isPending ? "送信中…" : "再設定メールを送る"}
      </button>
    </form>
  );
}

export function PasswordUpdateForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const pendingRef = useRef(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRef.current) return;

    if (password.length < 6) {
      setError("パスワードは6文字以上で入力してください。");
      return;
    }
    if (password !== confirmation) {
      setError("確認用パスワードが一致しません。");
      return;
    }

    pendingRef.current = true;
    setIsPending(true);
    setError(null);
    setMessage(null);

    try {
      const supabase = createClient();
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(getAuthErrorMessage(updateError, "password_update"));
        return;
      }

      const { error: signOutError } = await supabase.auth.signOut({ scope: "local" });
      if (signOutError) {
        setMessage(
          "パスワードを更新しました。ログイン画面へ戻り、新しいパスワードでログインしてください。",
        );
        return;
      }

      router.replace("/login?message=password_updated");
      router.refresh();
    } catch (caughtError) {
      setError(
        getAuthErrorMessage(
          caughtError instanceof Error ? { message: caughtError.message } : null,
          "password_update",
        ),
      );
    } finally {
      pendingRef.current = false;
      setIsPending(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      {error && (
        <p className={styles.error} role="alert" aria-live="assertive">
          {error}
        </p>
      )}
      {message && (
        <p className={styles.message} role="status" aria-live="polite">
          {message}
        </p>
      )}
      <label className={styles.field} htmlFor="new-password">
        新しいパスワード
      </label>
      <input
        className={styles.input}
        id="new-password"
        name="password"
        type="password"
        autoComplete="new-password"
        placeholder="6文字以上"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        disabled={isPending}
        minLength={6}
        required
      />
      <label className={styles.field} htmlFor="new-password-confirmation">
        新しいパスワード（確認）
      </label>
      <input
        className={styles.input}
        id="new-password-confirmation"
        name="password-confirmation"
        type="password"
        autoComplete="new-password"
        placeholder="もう一度入力"
        value={confirmation}
        onChange={(event) => setConfirmation(event.target.value)}
        disabled={isPending}
        minLength={6}
        required
      />
      <button className={styles.submitButton} type="submit" disabled={isPending}>
        {isPending ? "更新中…" : "パスワードを更新"}
      </button>
    </form>
  );
}
