"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type FormEvent,
  type KeyboardEvent,
  useId,
  useRef,
  useState,
} from "react";
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

function GoogleLogo() {
  return (
    <svg
      className={styles.googleLogo}
      viewBox="0 0 18 18"
      aria-hidden="true"
      focusable="false"
      data-testid="google-logo"
    >
      <path
        fill="#4285F4"
        d="M17.64 9.205c0-.638-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.797 2.715v2.258h2.909c1.702-1.567 2.684-3.874 2.684-6.613Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.468-.806 5.956-2.182l-2.909-2.258c-.806.54-1.835.859-3.047.859-2.344 0-4.328-1.585-5.037-3.714H.956v2.332A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.963 10.705A5.41 5.41 0 0 1 3.682 9c0-.592.102-1.168.281-1.705V4.963H.956A9 9 0 0 0 0 9c0 1.452.347 2.827.956 4.037l3.007-2.332Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.322 0 2.507.454 3.441 1.345l2.582-2.582C13.464.892 11.426 0 9 0A9 9 0 0 0 .956 4.963l3.007 2.332C4.672 5.166 6.656 3.58 9 3.58Z"
      />
    </svg>
  );
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
  const loginModeButtonRef = useRef<HTMLButtonElement | null>(null);
  const signupModeButtonRef = useRef<HTMLButtonElement | null>(null);
  const authFormId = useId();
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

  function handleModeKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    let nextMode: AuthMode | null = null;
    if (event.key === "ArrowLeft" || event.key === "Home") {
      nextMode = "login";
    } else if (event.key === "ArrowRight" || event.key === "End") {
      nextMode = "signup";
    }
    if (!nextMode) return;

    event.preventDefault();
    switchMode(nextMode);
    const nextButton =
      nextMode === "login" ? loginModeButtonRef.current : signupModeButtonRef.current;
    nextButton?.focus();
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
          "登録可能なメールアドレスには確認メールを送信しました。届かない場合は、すでにGoogleまたはメールアドレスで登録済みの可能性があります。ログインをお試しください。",
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
      <div className={styles.modeSwitcher} role="group" aria-label="認証方法">
        <button
          ref={loginModeButtonRef}
          className={mode === "login" ? styles.modeButtonActive : styles.modeButton}
          type="button"
          aria-pressed={mode === "login"}
          aria-controls={authFormId}
          disabled={isPending}
          onClick={() => switchMode("login")}
          onKeyDown={handleModeKeyDown}
        >
          ログイン
        </button>
        <button
          ref={signupModeButtonRef}
          className={mode === "signup" ? styles.modeButtonActive : styles.modeButton}
          type="button"
          aria-pressed={mode === "signup"}
          aria-controls={authFormId}
          disabled={isPending}
          onClick={() => switchMode("signup")}
          onKeyDown={handleModeKeyDown}
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
        <GoogleLogo />
        {pendingAction === "oauth" ? "Googleログイン中…" : "Googleでログイン"}
      </button>

      <div className={styles.divider} aria-hidden="true">
        <span>または</span>
      </div>

      <form id={authFormId} className={styles.form} onSubmit={handleSubmit} noValidate>
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
        {mode === "login" && (
          <Link className={styles.forgotLink} href="/forgot-password">
            パスワードを忘れた方
          </Link>
        )}
      </form>
    </div>
  );
}
