import { expect, test, type Page } from "@playwright/test";

const PLANTING_DATE = "2026-05-20";
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

type MailpitSummary = {
  messages?: Array<{
    ID?: unknown;
    To?: Array<{ Address?: unknown }>;
  }>;
};

type MailpitMessage = {
  HTML?: unknown;
  Text?: unknown;
};

async function recoveryLinkFromMailpit(email: string): Promise<string> {
  const mailpitUrl = process.env.E2E_MAILPIT_URL;
  if (!mailpitUrl) {
    throw new Error("E2E用Mailpit URLが準備されていません。");
  }

  let messageId = "";
  await expect
    .poll(
      async () => {
        const response = await fetch(`${mailpitUrl}/api/v1/messages`);
        if (!response.ok) return "";
        const body = (await response.json()) as MailpitSummary;
        const message = body.messages?.find((candidate) =>
          candidate.To?.some((recipient) => recipient.Address === email),
        );
        messageId = typeof message?.ID === "string" ? message.ID : "";
        return messageId;
      },
      { timeout: 15_000 },
    )
    .not.toBe("");

  const response = await fetch(
    `${mailpitUrl}/api/v1/message/${encodeURIComponent(messageId)}`,
  );
  if (!response.ok) {
    throw new Error(`再設定メールを取得できませんでした (HTTP ${response.status})。`);
  }
  const body = (await response.json()) as MailpitMessage;
  const content =
    typeof body.HTML === "string"
      ? body.HTML
      : typeof body.Text === "string"
        ? body.Text
        : "";
  const match = content.match(/https?:\/\/[^\s"'<>]+\/auth\/v1\/verify[^\s"'<>]*/);
  if (!match) {
    throw new Error("再設定メール内の確認リンクを取得できませんでした。");
  }
  return match[0].replaceAll("&amp;", "&");
}

test("ランディングから試用版のログイン導線を表示する", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page.getByText("試用版", { exact: true })).toBeVisible();
  await expect(page.getByText("試用版を公開中です。", { exact: true })).toBeVisible();

  const loginLink = page.getByRole("link", {
    name: "ログインして使う",
    exact: true,
  });
  await expect(loginLink).toBeVisible();
  await expect(loginLink).toHaveAttribute("href", "/login");
  const box = await loginLink.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  expect((box?.y ?? Number.POSITIVE_INFINITY) + (box?.height ?? 0)).toBeLessThanOrEqual(844);

  await loginLink.click();
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
});

test("未認証の /app はログインへ誘導し、ログインフォームを表示する", async ({ page }) => {
  await page.goto("/app");
  await expect(page).toHaveURL(/\/login\?next=%2Fapp/);
  await expect(page.getByLabel("メールアドレス")).toBeVisible();
  await expect(page.getByLabel("パスワード")).toBeVisible();
  const googleButton = page.getByRole("button", { name: "Googleでログイン" });
  await expect(googleButton).toBeVisible();
  const googleLogo = googleButton.getByTestId("google-logo");
  await expect(googleLogo).toBeVisible();
  await expect(googleLogo.locator("path")).toHaveCount(4);
  await expect
    .poll(() =>
      googleLogo.locator("path").evaluateAll((paths) =>
        paths.map((path) => path.getAttribute("fill")),
      ),
    )
    .toEqual(["#4285F4", "#34A853", "#FBBC05", "#EA4335"]);

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

test("ログイン済みでログイン画面を開くと登録フォームを隠す", async ({ page }) => {
  await login(page);
  await page.goto("/login");

  await expect(page.getByRole("heading", { name: "ログイン済みです" })).toBeVisible();
  await expect(page.getByText("メールアドレスでログイン済みです")).toBeVisible();
  await expect(page.getByLabel("メールアドレス")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Googleでログイン" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "アプリへ戻る" })).toHaveAttribute(
    "href",
    "/app",
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
  await expect(page.getByText("オフライン：保存済みの画面を表示中")).toHaveCount(0);
});

test("刈りどき設定は農家向けの3項目だけを大きく表示する", async ({ page }) => {
  await login(page);
  await page.goto("/app/settings/variety-rules");

  await expect(page.getByRole("heading", { name: "刈りどきの目安" })).toBeVisible();
  await expect(page.getByText("数字が分からないときは、入力しなくて大丈夫です")).toBeVisible();

  const koshihikari = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "コシヒカリ" }) });
  await koshihikari.getByRole("button", { name: "この品種の目安を登録する" }).click();

  const startInput = koshihikari.getByLabel("刈り始めの積算気温");
  const endInput = koshihikari.getByLabel("刈り終わりの積算気温");
  await expect(startInput).toBeVisible();
  await expect(endInput).toBeVisible();
  await expect(startInput).toHaveAttribute("placeholder", "参考：1000");
  await expect(endInput).toHaveAttribute("placeholder", "参考：1100");
  await expect(startInput).toHaveValue("");
  await expect(endInput).toHaveValue("");
  await expect(
    koshihikari.getByText("薄い数字は参考用の入力例です。地域や年によって変わるため、自動では保存しません。"),
  ).toBeVisible();
  await expect(koshihikari.getByLabel("この目安の出どころ")).toBeVisible();
  await expect(koshihikari.getByText("出穂日当日")).toBeVisible();
  await expect(koshihikari.getByText("三原市久井町")).toBeVisible();
  await expect(koshihikari.locator('input[type="number"]')).toHaveCount(2);
  await expect(koshihikari.locator('input[type="date"]')).toHaveCount(0);
  await expect(koshihikari.locator("select")).toHaveCount(0);
  await expect(koshihikari.getByText(/offset/i)).toHaveCount(0);

  const startBox = await koshihikari.getByLabel("刈り始めの積算気温").boundingBox();
  const saveBox = await koshihikari.getByRole("button", { name: "この目安を保存する" }).boundingBox();
  expect(startBox?.height ?? 0).toBeGreaterThanOrEqual(60);
  expect(saveBox?.height ?? 0).toBeGreaterThanOrEqual(52);

  await koshihikari.getByLabel("刈り始めの積算気温").fill("900");
  await koshihikari.getByLabel("刈り終わりの積算気温").fill("1100");
  await koshihikari.getByLabel("この目安の出どころ").fill("E2E用の作業ノート");
  await koshihikari.getByRole("button", { name: "この目安を保存する" }).click();
  await expect(page.getByRole("status")).toContainText("刈りどきの目安を保存しました");
  await expect(koshihikari.getByText("900℃・日")).toBeVisible();
  await expect(koshihikari.getByText("1,100℃・日")).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await koshihikari.getByRole("button", { name: "削除する" }).click();
  await expect(page.getByRole("status")).toContainText("刈りどきの目安を削除しました");
});

test("メールログインから田んぼ登録・詳細・収穫・ログアウトまで通る", async ({ page }) => {
  await login(page);
  await expect(page.getByRole("heading", { name: "今日の田んぼ" })).toBeVisible();
  await expect(page.getByText("開発用の見本を表示中です")).toHaveCount(0);
  await expect(page.getByRole("application")).toHaveCount(0);

  await page.getByRole("link", { name: /登録/ }).first().click();
  await expect(page).toHaveURL(/\/app\/fields\/new\/1$/);
  await expect(page.getByRole("heading", { name: "田んぼを登録" })).toBeVisible();
  await expect(page.getByRole("application")).toHaveCount(0);
  await page.getByLabel(/田んぼの名前/).fill("E2E久井テスト田んぼ");
  await page.locator("label").filter({ hasText: "大きめ" }).click();
  await expect(page.locator('input[name="size-class"][value="large"]')).toBeChecked();
  const varietySelect = page.getByLabel("品種");
  await expect(varietySelect.locator("option")).toHaveCount(6);
  const varietyNames = await varietySelect.locator("option").allTextContents();
  expect(varietyNames[0]).toBe("品種を選んでください");
  expect(varietyNames.slice(1).sort()).toEqual(
    ["あきさかり", "あきろまん", "コシヒカリ", "ヒノヒカリ", "恋の予感"].sort(),
  );
  await varietySelect.selectOption({ label: "コシヒカリ" });
  await page.getByLabel(/田植え日/).fill(PLANTING_DATE);
  await page.getByLabel(/出穂日/).fill(HEADING_DATE);
  await page.getByRole("button", { name: "この内容で登録する" }).click();
  await expect(page).toHaveURL(/\/app\/fields\/[0-9a-f-]+$/);
  await expect(page.getByRole("heading", { name: "E2E久井テスト田んぼ" })).toBeVisible();
  await expect(page.getByText("開発用の見本を表示中です")).toHaveCount(0);
  await expect(page.getByText("刈りどきの基準が未設定です")).toBeVisible();
  await expect(page.getByText("大", { exact: true })).toBeVisible();
  await expect(
    await page.evaluate(() => window.localStorage.getItem("karidoki-navi:simple-field-registration")),
  ).toBeNull();

  await page.getByRole("button", { name: "この田んぼの収穫を記録" }).click();
  const dialog = page.getByRole("dialog", { name: "収穫日を記録" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("収穫日").fill(HARVEST_DATE);
  await dialog.getByRole("button", { name: "記録する" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "収穫を記録しました" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "収穫を記録済み" })).toBeVisible();

  await page.getByRole("link", { name: "刈りどきナビ 田んぼ一覧へ" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("heading", { name: "E2E久井テスト田んぼ" })).toBeVisible();
  const fieldTile = page.getByRole("link", { name: /E2E久井テスト田んぼ/ });
  const tileBox = await fieldTile.boundingBox();
  expect(tileBox?.height ?? 0).toBeGreaterThanOrEqual(230);
  expect((tileBox?.width ?? 999) / (tileBox?.height ?? 1)).toBeLessThan(1.6);
  await fieldTile.click();
  await expect(page.getByText("この田んぼは収穫済みです。", { exact: true })).toBeVisible();

  await page.locator('summary[aria-label="アカウントメニュー"]').click();
  await page.getByRole("button", { name: "ログアウト" }).click();
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
  await expect(page.getByRole("button", { name: "メールアドレスでログイン" })).toBeVisible();
});

test("再設定メールからパスワードを更新して再ログインできる", async ({ page }) => {
  const email = process.env.E2E_TEST_EMAIL;
  if (!email) {
    throw new Error("E2E専用メールアドレスが準備されていません。");
  }
  const newPassword = "E2e-Recovered-Password-2026!";

  await page.goto("/login");
  await page.getByRole("link", { name: "パスワードを忘れた方" }).click();
  await expect(page).toHaveURL(/\/forgot-password$/);
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByRole("button", { name: "再設定メールを送る" }).click();
  await expect(page.getByRole("status")).toContainText("登録済みのメールアドレスであれば");

  const recoveryLink = await recoveryLinkFromMailpit(email);
  await page.goto(recoveryLink);
  await expect(page).toHaveURL(/\/reset-password$/);

  await page.getByLabel("新しいパスワード", { exact: true }).fill(newPassword);
  await page.getByLabel("新しいパスワード（確認）").fill(`${newPassword}-mismatch`);
  await page.getByRole("button", { name: "パスワードを更新" }).click();
  await expect(page.locator('p[role="alert"]')).toContainText(
    "確認用パスワードが一致しません",
  );

  await page.getByLabel("新しいパスワード（確認）").fill(newPassword);
  await page.getByRole("button", { name: "パスワードを更新" }).click();
  await expect(page).toHaveURL(/\/login\?message=password_updated/);
  await expect(page.getByRole("status")).toContainText("パスワードを更新しました");

  await page.getByLabel("メールアドレス").fill(email);
  await page.getByLabel("パスワード").fill(newPassword);
  await page.getByRole("button", { name: "メールアドレスでログイン" }).click();
  await expect(page).toHaveURL(/\/app(?:\?|$)/);
});
