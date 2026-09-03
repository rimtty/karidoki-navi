export const DEFAULT_AUTH_REDIRECT = "/app";

/** Keep redirect targets on this site to prevent an OAuth open redirect. */
export function getSafeRedirectPath(
  value: string | null | undefined,
): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return DEFAULT_AUTH_REDIRECT;
  }

  // Backslashes can be interpreted as path separators by some user agents.
  if (value.includes("\\") || value.includes("\r") || value.includes("\n")) {
    return DEFAULT_AUTH_REDIRECT;
  }

  try {
    const parsed = new URL(value, "http://localhost");
    if (parsed.origin !== "http://localhost") {
      return DEFAULT_AUTH_REDIRECT;
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return DEFAULT_AUTH_REDIRECT;
  }
}
