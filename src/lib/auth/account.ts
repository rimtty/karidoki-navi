export type AuthProvider = "google" | "email" | "other";

export type AuthenticatedAccountSummary = {
  email: string | null;
  currentProvider: AuthProvider;
  hasGoogleIdentity: boolean;
  hasEmailIdentity: boolean;
};

type AuthUserLike = {
  email?: string | null;
  app_metadata?: Record<string, unknown> | null;
  identities?: Array<{ provider?: string | null } | null> | null;
};

function normalizeProvider(value: unknown): AuthProvider {
  if (value === "google" || value === "email") {
    return value;
  }
  return "other";
}

export function summarizeAuthenticatedAccount(
  user: AuthUserLike,
): AuthenticatedAccountSummary {
  const identityProviders = new Set(
    (user.identities ?? [])
      .map((identity) => identity?.provider)
      .filter((provider): provider is string => typeof provider === "string"),
  );
  const currentProvider = normalizeProvider(user.app_metadata?.provider);

  return {
    email: typeof user.email === "string" && user.email ? user.email : null,
    currentProvider,
    hasGoogleIdentity:
      identityProviders.has("google") || currentProvider === "google",
    hasEmailIdentity:
      identityProviders.has("email") || currentProvider === "email",
  };
}
