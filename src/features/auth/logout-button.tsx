"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { getAuthErrorMessage } from "./auth-errors";
import { createClient } from "@/lib/supabase/client";

export function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef(false);

  async function handleLogout() {
    if (pendingRef.current) {
      return;
    }

    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      const { error: logoutError } = await createClient().auth.signOut();
      if (logoutError) {
        setError(getAuthErrorMessage(logoutError, "logout"));
        return;
      }

      router.replace("/login");
      router.refresh();
    } catch (caughtError) {
      setError(
        getAuthErrorMessage(
          caughtError instanceof Error ? { message: caughtError.message } : null,
          "logout",
        ),
      );
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  return (
    <div>
      <button type="button" onClick={handleLogout} disabled={pending}>
        {pending ? "ログアウト中…" : "ログアウト"}
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
