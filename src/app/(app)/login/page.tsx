import { AuthLoginView } from "@/features/auth-login-view";
import { getAuthCallbackErrorMessage } from "@/features/auth/auth-errors";
import { getSafeRedirectPath } from "@/lib/auth/redirect";

export const metadata = {
  title: "ログイン",
};

type LoginPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const errorCode = firstParam(params.error) ?? null;
  const messageCode = firstParam(params.message);

  return (
    <AuthLoginView
      nextPath={getSafeRedirectPath(firstParam(params.next))}
      initialError={errorCode ? getAuthCallbackErrorMessage(errorCode) : null}
      initialMessage={
        messageCode === "email_confirmed"
          ? "メールアドレスを確認しました。ログインを続けます。"
          : null
      }
    />
  );
}
