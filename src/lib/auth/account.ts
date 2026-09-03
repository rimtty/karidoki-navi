export type AuthProvider = "google" | "email" | "other";

export type AuthenticatedAccountSummary = {
  email: string | null;
  currentProvider: AuthProvider;
  hasGoogleIdentity: boolean;
  hasEmailIdentity: boolean;
  avatarUrl: string | null;
};

type AuthUserLike = {
  email?: string | null;
  app_metadata?: Record<string, unknown> | null;
  user_metadata?: Record<string, unknown> | null;
  identities?: Array<{
    provider?: string | null;
    identity_data?: Record<string, unknown> | null;
  } | null> | null;
};

function normalizeProvider(value: unknown): AuthProvider {
  if (value === "google" || value === "email") {
    return value;
  }
  return "other";
}

function asGoogleAvatarUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;

  try {
    const url = new URL(value);
    const isGoogleImageHost =
      url.hostname === "googleusercontent.com" ||
      url.hostname.endsWith(".googleusercontent.com");
    return url.protocol === "https:" && isGoogleImageHost ? url.toString() : null;
  } catch {
    return null;
  }
}

export function summarizeAuthenticatedAccount(
  user: AuthUserLike,
): AuthenticatedAccountSummary {
  const identities = user.identities ?? [];
  const identityProviders = new Set(
    identities
      .map((identity) => identity?.provider)
      .filter((provider): provider is string => typeof provider === "string"),
  );
  const currentProvider = normalizeProvider(user.app_metadata?.provider);
  const hasGoogleIdentity =
    identityProviders.has("google") || currentProvider === "google";
  const googleIdentity = identities.find(
    (identity) => identity?.provider === "google",
  );
  const avatarUrl = hasGoogleIdentity
    ? [
        googleIdentity?.identity_data?.avatar_url,
        googleIdentity?.identity_data?.picture,
        user.user_metadata?.avatar_url,
        user.user_metadata?.picture,
      ]
        .map(asGoogleAvatarUrl)
        .find((value): value is string => value !== null) ?? null
    : null;

  return {
    email: typeof user.email === "string" && user.email ? user.email : null,
    currentProvider,
    hasGoogleIdentity,
    hasEmailIdentity:
      identityProviders.has("email") || currentProvider === "email",
    avatarUrl,
  };
}
