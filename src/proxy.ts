import { NextRequest, NextResponse } from "next/server";
import { updateSupabaseSession } from "@/lib/supabase/proxy";

function isProtectedAppPath(pathname: string): boolean {
  return pathname === "/app" || pathname.startsWith("/app/");
}

function redirectToLogin(
  request: NextRequest,
  response: NextResponse,
  errorCode?: string,
) {
  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  const nextPath = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  loginUrl.searchParams.set("next", nextPath);
  if (errorCode) {
    loginUrl.searchParams.set("error", errorCode);
  }

  const redirectResponse = NextResponse.redirect(loginUrl);
  response.cookies.getAll().forEach((cookie) => {
    redirectResponse.cookies.set(cookie);
  });
  return redirectResponse;
}

export async function proxy(request: NextRequest) {
  const session = await updateSupabaseSession(request);

  // With no Supabase configuration the app deliberately runs in its
  // development-fixture mode. Production must fail closed so a missing
  // deployment variable cannot make fixture data look like user data.
  if (
    process.env.NODE_ENV === "production" &&
    !session.configured &&
    isProtectedAppPath(request.nextUrl.pathname)
  ) {
    return redirectToLogin(request, session.response, "missing_config");
  }

  // Once configured, protected routes require a validated Supabase user; RPC
  // loaders then enforce row ownership again.
  if (session.configured && isProtectedAppPath(request.nextUrl.pathname) && !session.user) {
    return redirectToLogin(request, session.response);
  }

  return session.response;
}

export const config = {
  matcher: ["/app/:path*"],
};
