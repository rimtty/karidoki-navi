import { readFile, rm } from "node:fs/promises";
import { E2E_RUNTIME_PATH } from "./global-setup";

type Runtime = {
  supabaseUrl: string;
  userId: string;
};

function restHeaders(serviceRoleKey: string): Record<string, string> {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    Prefer: "return=minimal",
  };
}

function isRuntime(value: unknown): value is Runtime {
  if (!value || typeof value !== "object") return false;
  const runtime = value as Partial<Runtime>;
  return (
    typeof runtime.supabaseUrl === "string" &&
    typeof runtime.userId === "string"
  );
}

export default async function globalTeardown(): Promise<void> {
  let raw: string;
  try {
    raw = await readFile(E2E_RUNTIME_PATH, "utf8");
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return;
    }
    throw error;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRuntime(parsed)) {
      throw new Error("E2E runtime file is invalid");
    }
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (!serviceRoleKey) {
      throw new Error(
        "E2E終了処理にSUPABASE_SERVICE_ROLE_KEYが必要です。ローカルSupabaseの環境を確認してください。",
      );
    }

    // accounts.created_by intentionally protects ownership rows from a direct
    // Auth delete. Remove only the random user's own account data first, then
    // delete the Auth user through the local admin endpoint. This keeps a
    // failed test from leaving fields or credentials behind.
    const accountsResponse = await fetch(
      `${parsed.supabaseUrl}/rest/v1/accounts?created_by=eq.${encodeURIComponent(parsed.userId)}&select=id`,
      { headers: restHeaders(serviceRoleKey) },
    );
    if (!accountsResponse.ok) {
      throw new Error(
        `ローカルSupabaseのE2Eアカウントを確認できませんでした (HTTP ${accountsResponse.status})。`,
      );
    }
    const accounts = (await accountsResponse.json()) as Array<{ id?: unknown }>;
    for (const account of accounts) {
      if (typeof account.id !== "string" || account.id.length === 0) continue;
      const accountId = encodeURIComponent(account.id);
      for (const resource of ["fields", "account_variety_rules", "account_members"]) {
        const response = await fetch(
          `${parsed.supabaseUrl}/rest/v1/${resource}?account_id=eq.${accountId}`,
          {
            method: "DELETE",
            headers: restHeaders(serviceRoleKey),
          },
        );
        if (!response.ok) {
          throw new Error(
            `ローカルSupabaseのE2Eデータを削除できませんでした (HTTP ${response.status})。`,
          );
        }
      }
      const response = await fetch(
        `${parsed.supabaseUrl}/rest/v1/accounts?id=eq.${accountId}`,
        {
          method: "DELETE",
          headers: restHeaders(serviceRoleKey),
        },
      );
      if (!response.ok) {
        throw new Error(
          `ローカルSupabaseのE2Eアカウントを削除できませんでした (HTTP ${response.status})。`,
        );
      }
    }

    const response = await fetch(
      `${parsed.supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(parsed.userId)}`,
      {
        method: "DELETE",
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
      },
    );
    if (!response.ok && response.status !== 404) {
      throw new Error(
        `ローカルSupabaseのE2E専用ユーザーを削除できませんでした (HTTP ${response.status})。`,
      );
    }
  } finally {
    // The runtime contains only a generated user id and email. Credentials
    // stay in process memory and are never written to the result directory.
    await rm(E2E_RUNTIME_PATH, { force: true });
  }
}
