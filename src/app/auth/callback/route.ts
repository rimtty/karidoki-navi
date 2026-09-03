import { createServerClient } from "@supabase/ssr";
import type { CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getSafeRedirectPath } from "@/lib/auth/redirect";
import { getSupabasePublicConfig } from "@/lib/supabase/config";

type PendingCookie = {
  name: string;
  value: string;
  options: CookieOptions;
};

function redirectToLogin(
  requestUrl: URL,
  errorCode: string,
  nextPath?: string,
) {
  const loginUrl = new URL("/login", requestUrl.origin);
  loginUrl.searchParams.set("error", errorCode);
  if (nextPath) {
    loginUrl.searchParams.set("next", getSafeRedirectPath(nextPath));
  }
  return NextResponse.redirect(loginUrl);
}

/** Exchange the PKCE code returned by Supabase OAuth/email confirmation. */
export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const nextPath = getSafeRedirectPath(requestUrl.searchParams.get("next"));
  const config = getSupabasePublicConfig();

  if (!config) {
    return redirectToLogin(requestUrl, "missing_config", nextPath);
  }
  if (!code) {
    return redirectToLogin(requestUrl, "missing_code", nextPath);
  }

  const cookieStore = await cookies();
  const pendingCookies: PendingCookie[] = [];
  const pendingHeaders: Record<string, string> = {};
  const supabase = createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet, headers) {
        pendingCookies.push(...cookiesToSet);
        Object.assign(pendingHeaders, headers);
      },
    },
  });

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return redirectToLogin(
      requestUrl,
      error.code ?? "callback_failed",
      nextPath,
    );
  }

  const response = NextResponse.redirect(
    new URL(nextPath, requestUrl.origin),
  );
  pendingCookies.forEach(({ name, value, options }) => {
    response.cookies.set(name, value, options);
  });
  Object.entries(pendingHeaders).forEach(([name, value]) => {
    response.headers.set(name, value);
  });
  return response;
}
