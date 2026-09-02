"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState } from "react";
import { getAuthErrorMessage } from "./auth-errors";
import { createClient } from "@/lib/supabase/client";
import { getSafeRedirectPath } from "@/lib/auth/redirect";
import styles from "./login-form.module.css";

type AuthMode = "login" | "signup";
type PendingAction = AuthMode | "oauth" | null;

type LoginFormProps = {
  nextPath?: string;
  initialMessage?: string | null;
  initialError?: string | null;
};

function getCallbackUrl(nextPath: string): string {
  const callbackUrl = new URL("/auth/callback", window.location.origin);
  callbackUrl.searchParams.set("next", nextPath);
  return callbackUrl.toString();
}

export function LoginForm({
  nextPath = "/app",
  initialMessage = null,
  initialError = null,
}: LoginFormProps) {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const pendingRef = useRef(false);
  const [error, setError] = useState(initialError);
  const [message, setMessage] = useState(initialMessage);
  const safeNextPath = getSafeRedirectPath(nextPath);

  function switchMode(nextMode: AuthMode) {
    if (pendingRef.current) {
      return;
    }
    setMode(nextMode);
    setError(null);
    setMessage(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRef.current) {
      return;
    }

    const normalizedEmail = email.trim();
    if (!normalizedEmail || !normalizedEmail.includes("@")) {
      setError("メールアドレスの形式を確認してください。");
      return;
    }
    if (password.length < 6) {
      setError("パスワードは6文字以上で入力してください。");
      return;
    }

    pendingRef.current = true;
    setPendingAction(mode);
    setError(null);
    setMessage(null);

    try {
      const supabase = createClient();
      const result =
        mode === "login"
          ? await supabase.auth.signInWithPassword({
              email: normalizedEmail,
              password,
            })
          : await supabase.auth.signUp({
              email: normalizedEmail,
              password,
              options: {
                emailRedirectTo: getCallbackUrl(safeNextPath),
              },
            });

      if (result.error) {
        setError(getAuthErrorMessage(result.error, mode));
        return;
      }

      if (mode === "signup" && !result.data.session) {
        setMessage(
          "確認メールを送信しました。メール内のリンクを開くと登録が完了します。",
        );
        setPassword("");
        return;
      }

      router.replace(safeNextPath);
      router.refresh();
    } catch (caughtError) {
      setError(
        getAuthErrorMessage(
          caughtError instanceof Error ? { message: caughtError.message } : null,
          mode,
        ),
      );
    } finally {
      pendingRef.current = false;
      setPendingAction(null);
    }
  }

  async function handleGoogleLogin() {
    if (pendingRef.current) {
      return;
    }

    pendingRef.current = true;
    setPendingAction("oauth");
    setError(null);
    setMessage(null);

    try {
      const { data, error: oauthError } = await createClient().auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: getCallbackUrl(safeNextPath),
        },
      });

      if (oauthError) {
        setError(getAuthErrorMessage(oauthError, "oauth"));
        return;
      }

      // Supabase normally redirects automatically. This fallback also keeps
      // the flow working when the client is configured with a custom option.
      if (data.url) {
        window.location.assign(data.url);
      }
    } catch (caughtError) {
      setError(
        getAuthErrorMessage(
          caughtError instanceof Error ? { message: caughtError.message } : null,
          "oauth",
        ),
      );
    } finally {
      pendingRef.current = false;
      setPendingAction(null);
    }
  }

  const isPending = pendingAction !== null;

  return (
    <div className={styles.formRoot} aria-busy={isPending}>
      <div className={styles.modeSwitcher} role="tablist" aria-label="認証方法">
        <button
          className={mode === "login" ? styles.modeButtonActive : styles.modeButton}
          type="button"
          role="tab"
          aria-selected={mode === "login"}
          disabled={isPending}
          onClick={() => switchMode("login")}
        >
          ログイン
        </button>
        <button
          className={mode === "signup" ? styles.modeButtonActive : styles.modeButton}
          type="button"
          role="tab"
          aria-selected={mode === "signup"}
          disabled={isPending}
          onClick={() => switchMode("signup")}
        >
          新規登録
        </button>
      </div>

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

      <button
        className={styles.googleButton}
        type="button"
        disabled={isPending}
        onClick={handleGoogleLogin}
      >
        <span className={styles.googleGlyph} aria-hidden="true">
          G
        </span>
        {pendingAction === "oauth" ? "Googleログイン中…" : "Googleでログイン"}
      </button>

      <div className={styles.divider} aria-hidden="true">
        <span>または</span>
      </div>

      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        <label className={styles.field} htmlFor="auth-email">
          メールアドレス
        </label>
        <input
          className={styles.input}
          id="auth-email"
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

        <label className={styles.field} htmlFor="auth-password">
          パスワード
        </label>
        <input
          className={styles.input}
          id="auth-password"
          name="password"
          type="password"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          placeholder="6文字以上"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={isPending}
          minLength={6}
          required
        />

        <button className={styles.submitButton} type="submit" disabled={isPending}>
          {pendingAction === mode
            ? mode === "login"
              ? "ログイン中…"
              : "登録中…"
            : mode === "login"
              ? "メールアドレスでログイン"
              : "メールアドレスで新規登録"}
        </button>
      </form>
    </div>
  );
}
