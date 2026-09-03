import { expect, test, type Page, type Route } from "@playwright/test";

const HEADING_DATE = "2026-08-01";
const HARVEST_DATE = "2026-09-03";

async function login(page: Page) {
  const email = process.env.E2E_TEST_EMAIL;
  const password = process.env.E2E_TEST_PASSWORD;
  if (!email || !password) {
    throw new Error("E2E専用ログイン情報が準備されていません。");
  }

  await page.goto("/login?next=%2Fapp");
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByLabel("パスワード").fill(password);
  await page.getByRole("button", { name: "メールアドレスでログイン" }).click();
  await expect(page).toHaveURL(/\/app(?:\?|$)/);
}

async function blockRemoteMapAssets(page: Page) {
  // The field flow only needs map interaction; public map assets are not part
  // of the assertion and can be unavailable in an offline CI runner.
  await page.route("https://cyberjapandata.gsi.go.jp/**", (route: Route) => route.abort());
  await page.route("https://demotiles.maplibre.org/**", (route: Route) => route.abort());
}

test("未認証の /app はログインへ誘導し、ログインフォームを表示する", async ({ page }) => {
  await page.goto("/app");
  await expect(page).toHaveURL(/\/login\?next=%2Fapp/);
  await expect(page.getByLabel("メールアドレス")).toBeVisible();
  await expect(page.getByLabel("パスワード")).toBeVisible();
  await expect(page.getByRole("button", { name: "Googleでログイン" })).toBeVisible();

  await page.getByRole("button", { name: "メールアドレスでログイン" }).click();
  await expect(page.locator('p[role="alert"]')).toContainText("メールアドレスの形式");

  await page.getByLabel("メールアドレス").fill("e2e-invalid@example.test");
  await page.getByLabel("パスワード").fill("short");
  await page.getByRole("button", { name: "メールアドレスでログイン" }).click();
  await expect(page.locator('p[role="alert"]')).toContainText("パスワードは6文字以上");

  await page.getByLabel("パスワード").fill("wrong-password");
  await page.getByRole("button", { name: "メールアドレスでログイン" }).click();
  await expect(page.locator('p[role="alert"]')).toContainText(
    "メールアドレスまたはパスワードが正しくありません",
  );
});

test("PWA の manifest・Service Worker・オフライン表示を確認する", async ({ page, context }) => {
  await page.goto("/login");
  const manifest = await page.evaluate(async () => {
    const response = await fetch("/manifest.webmanifest");
    return (await response.json()) as {
      name?: string;
      display?: string;
      scope?: string;
      lang?: string;
    };
  });
  expect(manifest.name).toBe("刈りどきナビ");
  expect(manifest.display).toBe("standalone");
  expect(manifest.scope).toBe("/");
  expect(manifest.lang).toBe("ja");

  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          if (!("serviceWorker" in navigator)) return false;
          const registrations = await navigator.serviceWorker.getRegistrations();
          return registrations.some((registration) => registration.scope.endsWith("/"));
        }),
      { timeout: 15_000 },
    )
    .toBe(true);

  await context.setOffline(true);
  await expect(page.getByText("オフライン：保存済みの画面を表示中")).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByText("オンライン")).toBeVisible();
});

test("メールログインから圃場登録・一覧・詳細・収穫・ログアウトまで通る", async ({ page }) => {
  await blockRemoteMapAssets(page);
  const mapWorkers: string[] = [];
  page.on("worker", (worker) => mapWorkers.push(worker.url()));
  await login(page);
  await expect(page.getByRole("heading", { name: "今日の刈りどき" })).toBeVisible();
  await expect
    .poll(() => mapWorkers.some((url) => url.endsWith("/maplibre-gl-worker.mjs")))
    .toBe(true);
  await expect(page.getByText("開発用フィクスチャを表示中")).toHaveCount(0);

  await page.getByRole("link", { name: "一覧", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/fields$/);
  await expect(page.getByRole("heading", { name: "田んぼ一覧" })).toBeVisible();
  await expect(page.getByText("開発用フィクスチャを表示中")).toHaveCount(0);

  await page.getByRole("link", { name: /登録/ }).first().click();
  await expect(page).toHaveURL(/\/app\/fields\/new\/1$/);
  await expect(page.getByRole("heading", { name: "区画を選ぶ" })).toBeVisible();
  await page.getByRole("button", { name: "手描きする" }).click();

  const map = page.getByRole("application", {
    name: "手描き用の地図。タップして点を追加できます。",
  });
  await expect(map).toBeVisible();
  await expect(page.getByText("地図をタップして点を追加")).toBeVisible();
  const box = await map.boundingBox();
  if (!box) throw new Error("手描き地図の表示領域を取得できませんでした。");
  for (const [x, y] of [
    [0.27, 0.34],
    [0.73, 0.34],
    [0.62, 0.68],
  ]) {
    await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
  }
  await expect(page.getByText("区画を囲めます")).toBeVisible();
  await expect(page.getByRole("button", { name: /作付け入力へ/ })).toBeEnabled();
  await page.getByRole("button", { name: /作付け入力へ/ }).click();

  await expect(page).toHaveURL(/\/app\/fields\/new\/2$/);
  await page.getByLabel(/圃場名/).fill("E2E久井テスト圃場");
  const varietySelect = page.getByLabel("品種");
  await expect(varietySelect.locator("option")).toHaveCount(6);
  const varietyNames = await varietySelect.locator("option").allTextContents();
  expect(varietyNames[0]).toBe("品種を選択してください");
  expect(varietyNames.slice(1).sort()).toEqual(
    ["あきさかり", "あきろまん", "コシヒカリ", "ヒノヒカリ", "恋の予感"].sort(),
  );
  await varietySelect.selectOption({ label: "コシヒカリ" });
  await page.getByLabel(/出穂日/).fill(HEADING_DATE);
  await page.getByRole("button", { name: /確認へ/ }).click();

  await expect(page).toHaveURL(/\/app\/fields\/new\/3$/);
  await expect(page.getByRole("heading", { name: "内容を確認" })).toBeVisible();
  await expect(page.getByText("E2E久井テスト圃場")).toBeVisible();
  await page.getByRole("button", { name: /保存して詳細へ/ }).click();
  await expect(page).toHaveURL(/\/app\/fields\/[0-9a-f-]+$/);
  await expect(page.getByRole("heading", { name: "E2E久井テスト圃場" })).toBeVisible();
  await expect(page.getByText("開発用フィクスチャを表示中")).toHaveCount(0);
  await expect(page.getByText("公式ルール未設定")).toBeVisible();
  await expect(
    await page.evaluate(() => window.localStorage.getItem("karidoki-navi:field-registration-draft")),
  ).toBeNull();

  await page.getByRole("button", { name: "収穫を登録" }).click();
  const dialog = page.getByRole("dialog", { name: "収穫を登録" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("収穫日").fill(HARVEST_DATE);
  await dialog.getByRole("button", { name: "登録する" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "収穫を記録しました" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "収穫記録済み" })).toBeVisible();

  await page.getByRole("link", { name: "刈りどきナビ 地図へ" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await page.getByRole("link", { name: "田んぼ一覧" }).click();
  await expect(page.getByRole("heading", { name: "E2E久井テスト圃場" })).toBeVisible();
  await page.getByRole("link", { name: /E2E久井テスト圃場/ }).click();
  await expect(page.getByText("収穫済", { exact: true })).toBeVisible();

  await page.locator('summary[aria-label="アカウントメニュー"]').click();
  await page.getByRole("button", { name: "ログアウト" }).click();
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
  await expect(page.getByRole("button", { name: "メールアドレスでログイン" })).toBeVisible();
});
