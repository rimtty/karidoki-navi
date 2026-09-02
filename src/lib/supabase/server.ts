import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { requireSupabasePublicConfig } from "./config";
import type { Database } from "./database.types";

/**
 * Create a request-scoped server client. The auth session is persisted in
 * cookies so that the browser, route handlers, and Proxy share one session.
 */
export async function createClient() {
  const { url, publishableKey } = requireSupabasePublicConfig();
  const cookieStore = await cookies();

  return createServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        // Server Components cannot always mutate response cookies. Proxy and
        // route handlers perform the actual refresh writes when available.
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Ignore immutable-cookie contexts (for example, a Server Component).
        }
      },
    },
  });
}
