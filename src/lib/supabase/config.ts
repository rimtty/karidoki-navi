/**
 * Values with the NEXT_PUBLIC_ prefix are safe to expose to the browser.
 * Never add a service-role or other secret key to this module.
 */
export type SupabasePublicConfig = {
  url: string;
  publishableKey: string;
};

export const SUPABASE_CONFIG_ERROR =
  "Supabaseの接続設定がありません。管理者が設定を確認して再試行してください。";

export function getSupabasePublicConfig(): SupabasePublicConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

  if (
    !url ||
    !publishableKey ||
    url.includes("your-project-ref") ||
    publishableKey.includes("replace_me")
  ) {
    return null;
  }

  try {
    const parsedUrl = new URL(url);
    const isLocalDevelopment = process.env.NODE_ENV !== "production";
    if (
      parsedUrl.protocol !== "https:" &&
      !(isLocalDevelopment && parsedUrl.protocol === "http:")
    ) {
      return null;
    }
  } catch {
    return null;
  }

  return { url, publishableKey };
}

export function requireSupabasePublicConfig(): SupabasePublicConfig {
  const config = getSupabasePublicConfig();

  if (!config) {
    throw new Error(SUPABASE_CONFIG_ERROR);
  }

  return config;
}
