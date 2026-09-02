import { createServerClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { getSupabasePublicConfig } from "./config";

export type SupabaseSessionUpdate = {
  response: NextResponse;
  user: User | null;
  configured: boolean;
};

/**
 * Refresh the Supabase session before a protected route is rendered.
 *
 * `getUser` validates the access token with Supabase and also causes the SSR
 * client to write refreshed cookies through `setAll` when necessary.
 */
export async function updateSupabaseSession(
  request: NextRequest,
): Promise<SupabaseSessionUpdate> {
  const config = getSupabasePublicConfig();
  let response = NextResponse.next({ request });

  if (!config) {
    return { response, user: null, configured: false };
  }

  const supabase = createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        // Keep the request cookie jar in sync before constructing the response
        // so a refresh is immediately visible to downstream Server Components.
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });

        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
        Object.entries(headers).forEach(([name, value]) => {
          response.headers.set(name, value);
        });
      },
    },
  });

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return { response, user, configured: true };
  } catch {
    // A temporary Auth API/network failure must not turn a protected route
    // into a server error. The caller treats this as an unauthenticated user.
    return { response, user: null, configured: true };
  }
}
