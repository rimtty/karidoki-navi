import { spawn, spawnSync } from "node:child_process";

function parseStatusValue(output, name) {
  const line = output
    .split(/\r?\n/)
    .find((candidate) => new RegExp(`^\\s*${name}\\s*=`).test(candidate));
  if (!line) return null;
  const value = line.slice(line.indexOf("=") + 1).trim();
  return value.replace(/^['"]|['"]$/g, "");
}

function localSupabaseEnvironment() {
  const result = spawnSync("pnpm", ["exec", "supabase", "status", "--output", "env"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status !== 0 || !result.stdout) {
    throw new Error(
      "ローカルSupabaseの状態を取得できません。先に `pnpm exec supabase start` を実行してください。",
    );
  }

  const apiUrl = parseStatusValue(result.stdout, "API_URL");
  const anonKey = parseStatusValue(result.stdout, "ANON_KEY");
  const serviceRoleKey = parseStatusValue(result.stdout, "SERVICE_ROLE_KEY");
  const mailpitUrl =
    parseStatusValue(result.stdout, "MAILPIT_URL") ??
    parseStatusValue(result.stdout, "INBUCKET_URL");
  if (!apiUrl || !anonKey || !serviceRoleKey || !mailpitUrl) {
    throw new Error("ローカルSupabaseの接続情報が不足しています。状態を確認して再試行してください。");
  }

  return {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? apiUrl,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? anonKey,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? serviceRoleKey,
    E2E_MAILPIT_URL: process.env.E2E_MAILPIT_URL ?? mailpitUrl,
  };
}

let environment;
try {
  environment = localSupabaseEnvironment();
} catch (error) {
  console.error(error instanceof Error ? error.message : "ローカルSupabaseの準備に失敗しました。");
  process.exit(1);
}

const child = spawn("pnpm", ["e2e", ...process.argv.slice(2)], {
  env: environment,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 1);
  }
});
