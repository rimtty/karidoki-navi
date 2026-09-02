"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabasePublicConfig } from "./config";
import type { Database } from "./database.types";

let browserClient: SupabaseClient<Database> | undefined;

/** Create the browser client used by email and OAuth interactions. */
export function createClient(): SupabaseClient<Database> {
  if (browserClient) {
    return browserClient;
  }

  const { url, publishableKey } = requireSupabasePublicConfig();
  browserClient = createBrowserClient<Database>(url, publishableKey);
  return browserClient;
}
