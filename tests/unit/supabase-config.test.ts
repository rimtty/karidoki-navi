import { afterEach, describe, expect, it, vi } from "vitest";
import { getSupabasePublicConfig } from "../../src/lib/supabase/config";

const publishableKey = "sb_publishable_test_key";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Supabase public configuration", () => {
  it("allows an HTTP endpoint only outside production", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", " http://127.0.0.1:54321 ");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", publishableKey);

    expect(getSupabasePublicConfig()).toEqual({
      url: "http://127.0.0.1:54321",
      publishableKey,
    });

    vi.stubEnv("NODE_ENV", "production");
    expect(getSupabasePublicConfig()).toBeNull();
  });

  it("accepts HTTPS in production and rejects placeholder values", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", publishableKey);

    expect(getSupabasePublicConfig()).toEqual({
      url: "https://example.supabase.co",
      publishableKey,
    });

    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://your-project-ref.supabase.co");
    expect(getSupabasePublicConfig()).toBeNull();
  });
});
