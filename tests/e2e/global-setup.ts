import { randomBytes } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export const E2E_RUNTIME_PATH = path.resolve(
  process.cwd(),
  "test-results/e2e-runtime.json",
);

type Runtime = {
  supabaseUrl: string;
  userId: string;
  email: string;
};

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `E2Eには${name}が必要です。ローカルSupabaseの接続情報を設定して再試行してください。`,
    );
  }
  return value;
}

function assertLocalSupabase(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("E2EのSupabase URLが不正です。ローカルURLを指定してください。");
  }

  if (
    parsed.protocol !== "http:" ||
    (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost")
  ) {
    throw new Error(
      "E2Eは本番データを変更しないため、127.0.0.1 または localhost のSupabaseだけを対象にします。",
    );
  }
}

function adminHeaders(serviceRoleKey: string): Record<string, string> {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "content-type": "application/json",
  };
}

async function deleteUser(runtime: Runtime, serviceRoleKey: string): Promise<void> {
  const response = await fetch(
    `${runtime.supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(runtime.userId)}`,
    {
      method: "DELETE",
      headers: adminHeaders(serviceRoleKey),
    },
  );
  if (!response.ok && response.status !== 404) {
    throw new Error(
      `ローカルSupabaseのE2E専用ユーザーを削除できませんでした (HTTP ${response.status})。`,
    );
  }
}

/** Create one isolated local auth user for the browser flow. */
export default async function globalSetup(): Promise<void> {
  const supabaseUrl = requiredEnvironment("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY");
  assertLocalSupabase(supabaseUrl);

  await mkdir(path.dirname(E2E_RUNTIME_PATH), { recursive: true });
  await rm(E2E_RUNTIME_PATH, { force: true });

  const suffix = `${Date.now().toString(36)}-${randomBytes(6).toString("hex")}`;
  const email = `playwright-${suffix}@example.test`;
  const password = `E2e-${randomBytes(24).toString("base64url")}!`;

  const response = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method: "POST",
    headers: adminHeaders(serviceRoleKey),
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: "Playwright E2E" },
    }),
  });

  if (!response.ok) {
    throw new Error(
      `ローカルSupabaseのE2E専用ユーザーを作成できませんでした (HTTP ${response.status})。`,
    );
  }

  const body = (await response.json()) as { id?: unknown };
  if (typeof body.id !== "string" || body.id.length === 0) {
    throw new Error("ローカルSupabaseからE2E専用ユーザーIDを取得できませんでした。");
  }

  const runtime: Runtime = {
    supabaseUrl,
    userId: body.id,
    email,
  };

  try {
    await writeFile(E2E_RUNTIME_PATH, JSON.stringify(runtime), {
      encoding: "utf8",
      mode: 0o600,
    });
  } catch (error) {
    await deleteUser(runtime, serviceRoleKey).catch(() => undefined);
    throw error;
  }

  // Global setup runs before workers. These values are therefore available to
  // the tests without putting a local password in the repository or CI logs.
  process.env.E2E_TEST_EMAIL = email;
  process.env.E2E_TEST_PASSWORD = password;
}
