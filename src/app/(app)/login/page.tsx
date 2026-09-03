import { AuthLoginView } from "@/features/auth-login-view";
import { getAuthCallbackErrorMessage } from "@/features/auth/auth-errors";
import { summarizeAuthenticatedAccount } from "@/lib/auth/account";
import { getSafeRedirectPath } from "@/lib/auth/redirect";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: "ログイン",
};

type LoginPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

async function getAuthenticatedAccount() {
  if (!getSupabasePublicConfig()) {
    return null;
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user ? summarizeAuthenticatedAccount(user) : null;
  } catch {
    // The login form must remain available if session lookup is unavailable.
    return null;
  }
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const [params, authenticatedAccount] = await Promise.all([
    searchParams,
    getAuthenticatedAccount(),
  ]);
  const errorCode = firstParam(params.error) ?? null;
  const messageCode = firstParam(params.message);

  return (
    <AuthLoginView
      nextPath={getSafeRedirectPath(firstParam(params.next))}
      authenticatedAccount={authenticatedAccount}
      initialError={errorCode ? getAuthCallbackErrorMessage(errorCode) : null}
      initialMessage={
        messageCode === "email_confirmed"
          ? "メールアドレスを確認しました。ログインを続けます。"
          : messageCode === "password_updated"
            ? "パスワードを更新しました。新しいパスワードでログインしてください。"
            : null
      }
    />
  );
}
