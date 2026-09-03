import { describe, expect, it } from "vitest";
import { getSafeRedirectPath } from "../../src/lib/auth/redirect";
import { getAuthErrorMessage } from "../../src/features/auth/auth-errors";
import { summarizeAuthenticatedAccount } from "../../src/lib/auth/account";

describe("auth redirect targets", () => {
  it("keeps same-site paths and their query string", () => {
    expect(getSafeRedirectPath("/app/fields?from=login#map")).toBe(
      "/app/fields?from=login#map",
    );
  });

  it("rejects external and ambiguous redirect targets", () => {
    expect(getSafeRedirectPath("https://example.com")).toBe("/app");
    expect(getSafeRedirectPath("//example.com")).toBe("/app");
    expect(getSafeRedirectPath("/\\\\example.com")).toBe("/app");
  });
});

describe("authenticated account summary", () => {
  it("detects a Google-authenticated account without an email identity", () => {
    expect(
      summarizeAuthenticatedAccount({
        email: "farmer@example.com",
        app_metadata: { provider: "google" },
        identities: [{ provider: "google" }],
      }),
    ).toEqual({
      email: "farmer@example.com",
      currentProvider: "google",
      hasGoogleIdentity: true,
      hasEmailIdentity: false,
    });
  });

  it("keeps email-only users distinct from Google users", () => {
    expect(
      summarizeAuthenticatedAccount({
        email: "farmer@example.com",
        app_metadata: { provider: "email" },
        identities: [{ provider: "email" }],
      }),
    ).toMatchObject({
      currentProvider: "email",
      hasGoogleIdentity: false,
      hasEmailIdentity: true,
    });
  });
});

describe("auth error messages", () => {
  it("returns Japanese messages for common Supabase errors", () => {
    expect(
      getAuthErrorMessage({ code: "invalid_credentials" }, "login"),
    ).toContain("メールアドレスまたはパスワード");
    expect(
      getAuthErrorMessage({ code: "provider_disabled" }, "oauth"),
    ).toContain("Googleログイン");
  });

  it("does not expose an unknown provider error verbatim", () => {
    const message = getAuthErrorMessage(
      { message: "internal provider details: token=secret" },
      "oauth",
    );
    expect(message).not.toContain("token=secret");
    expect(message).toContain("Googleログイン");
  });

  it("returns safe Japanese messages for password recovery", () => {
    expect(
      getAuthErrorMessage({ code: "session_not_found" }, "password_update"),
    ).toContain("再設定メール");
    expect(
      getAuthErrorMessage(
        { message: "internal smtp detail: password=secret" },
        "recovery_request",
      ),
    ).not.toContain("password=secret");
  });
});
