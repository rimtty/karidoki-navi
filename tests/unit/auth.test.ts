import { describe, expect, it } from "vitest";
import { getSafeRedirectPath } from "../../src/lib/auth/redirect";
import { getAuthErrorMessage } from "../../src/features/auth/auth-errors";

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
});
