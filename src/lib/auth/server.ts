import "server-only";

import { summarizeAuthenticatedAccount } from "@/lib/auth/account";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export async function getAuthenticatedAccountSummary() {
  if (!getSupabasePublicConfig()) return null;

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user ? summarizeAuthenticatedAccount(user) : null;
  } catch {
    return null;
  }
}
