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
  errorCode: string,
  nextPath?: string,
) {
  const params = new URLSearchParams({ error: errorCode });
  if (nextPath) {
    params.set("next", getSafeRedirectPath(nextPath));
  }
  return new NextResponse(null, {
    status: 307,
    headers: { Location: `/login?${params.toString()}` },
  });
}

/** Exchange the PKCE code returned by Supabase OAuth/email confirmation. */
export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const nextPath = getSafeRedirectPath(requestUrl.searchParams.get("next"));
  const config = getSupabasePublicConfig();

  if (!config) {
    return redirectToLogin("missing_config", nextPath);
  }
  if (!code) {
    return redirectToLogin("missing_code", nextPath);
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
      error.code ?? "callback_failed",
      nextPath,
    );
  }

  // A relative Location preserves the browser-visible origin through local
  // dev servers and reverse proxies. Rebuilding the origin from Request.url
  // can switch 127.0.0.1 to localhost and strand host-only auth cookies.
  const response = new NextResponse(null, {
    status: 307,
    headers: { Location: nextPath },
  });
  pendingCookies.forEach(({ name, value, options }) => {
    response.cookies.set(name, value, options);
  });
  Object.entries(pendingHeaders).forEach(([name, value]) => {
    response.headers.set(name, value);
  });
  return response;
}
