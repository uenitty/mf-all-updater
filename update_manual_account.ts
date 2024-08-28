import "dotenv/config";

import path from "path";

import { chromium } from "playwright";

const HEADLESS = process.env.HEADLESS || "";
const PLAYWRIGHT_DEBUG = process.env.PLAYWRIGHT_DEBUG || "";
const USER_DATA_DIR = "./user_data/";
const SCREENSHOT_DIR = "./screenshot/";

const EMAIL = process.env.EMAIL || "";
const PASSWORD = process.env.PASSWORD || "";
const MANUAL_ACCOUNT_NAME = process.env.MANUAL_ACCOUNT_NAME || ""; // 口座名
const SYMBOL = process.env.SYMBOL || ""; // 銘柄コード
const NUMBER_OF_SHARES = process.env.NUMBER_OF_SHARES || ""; // 保有株数
const BVPS = process.env.BVPS || ""; // 簿価単価

(async () => {
  if (!EMAIL || !PASSWORD) {
    console.error("Please set EMAIL and PASSWORD environment variables.");
    process.exitCode = 1;
    return;
  }

  console.debug({ HEADLESS, USER_DATA_DIR, SCREENSHOT_DIR });

  console.debug("launch browser");
  const context = await chromium.launchPersistentContext(
    path.join(__dirname, USER_DATA_DIR),
    {
      baseURL: "https://moneyforward.com",
      headless: HEADLESS === "true",
      locale: "ja-JP",
      logger: {
        isEnabled: (_name, _severity) => PLAYWRIGHT_DEBUG === "true",
        log: (name, severity, message, args, hints) =>
          console.log(`${name} [${severity}] ${message}`, { args, hints }),
      },
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/104.0.5112.48 Safari/537.36",
    },
  );

  const page = await context.newPage();

  try {
    console.debug("goto /accounts");
    await page.goto("/accounts");

    const maintenanceText = page.getByText("メンテナンス作業中です");
    if (await maintenanceText.count()) {
      console.debug("exit メンテナンス作業中");
      return;
    }

    const loginLink = page.locator('a[href="/sign_in"]', {
      hasText: "ログイン",
    });
    if (await loginLink.count()) {
      console.debug("click ログイン");
      await Promise.all([page.waitForURL(/\/sign_in/), loginLink.click()]);
    }

    const loginWithEmailLink = page.locator('a[href^="/sign_in/email"]', {
      hasText: "メールアドレスでログイン",
    });
    if (await loginWithEmailLink.count()) {
      console.debug("click メールアドレスでログイン");
      await Promise.all([
        page.waitForURL(/\/sign_in/),
        loginWithEmailLink.click(),
      ]);
    }

    const emailInput = page.locator('input[type="email"]');
    const passwordInput = page.locator('input[type="password"]');
    if ((await emailInput.count()) || (await passwordInput.count())) {
      console.debug("fill EMAIL");
      await emailInput.fill(EMAIL);
      console.debug("fill PASSWORD");
      await passwordInput.fill(PASSWORD);
      console.debug("submit EMAIL and PASSWORD");
      await Promise.all([
        page.waitForURL(/\/sign_in/),
        passwordInput.press("Enter"),
      ]);
    }

    const additionalCertificationText = page.getByText("追加認証");
    if (await additionalCertificationText.count()) {
      console.debug("exit 追加認証");
      return;
    }

    console.debug("goto /accounts");
    await page.goto("/accounts");

    const useThisAccountButton = page.getByRole("button", {
      name: "このアカウントを使用する",
    });
    if (await useThisAccountButton.count()) {
      console.debug("click このアカウントを使用する");
      await Promise.all([
        page.waitForURL(/\/accounts/),
        useThisAccountButton.click(),
      ]);
    }

    const selectThisAccountButton = page.getByRole("button", {
      name: "メールアドレスでログイン",
    });
    if (await selectThisAccountButton.count()) {
      console.debug("click メールアドレスでログイン");
      await Promise.all([
        page.waitForURL(/\/accounts/),
        selectThisAccountButton.click(),
      ]);
    }

    console.debug("click 口座名");
    await Promise.all([
      page.waitForURL(/\/accounts\/show_manual.*/),
      page.getByRole("link", { name: MANUAL_ACCOUNT_NAME }).click(),
    ]);

    console.debug("click 変更");
    await page.getByAltText("変更").click();

    console.debug("fetch 現在の株価");
    const response = await fetch(
      `https://query2.finance.yahoo.com/v8/finance/chart/${SYMBOL}`,
    );
    const body = await response.json();
    const regularMarketPrice = Number(
      body?.chart?.result?.[0]?.meta?.regularMarketPrice ?? 0,
    );

    if (!Number.isFinite(regularMarketPrice) || regularMarketPrice <= 0) {
      console.error("regularMarketPrice is invalid.", {
        body,
        regularMarketPrice,
      });
      process.exitCode = 1;
      return;
    }

    console.debug("fill 現在の価値");
    await page
      .getByText("現在の価値")
      .locator("..")
      .getByRole("textbox")
      .fill(
        `${Math.round(Number(regularMarketPrice) * Number(NUMBER_OF_SHARES))}`,
      );

    console.debug("fill 購入価格");
    await page
      .getByText("購入価格")
      .locator("..")
      .getByRole("textbox")
      .fill(`${Math.round(Number(BVPS) * Number(NUMBER_OF_SHARES))}`);

    console.debug("click この内容で登録する");
    await Promise.all([
      page.waitForURL(/\/accounts\/show_manual.*/),
      page.getByRole("button", { name: "この内容で登録する" }).click(),
    ]);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;

    const screenshot = path.join(
      __dirname,
      SCREENSHOT_DIR,
      `${new Date().toLocaleDateString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "Asia/Tokyo", timeZoneName: "short" }).replaceAll("/", "-").replaceAll(":", "-")}.png`,
    );
    console.error("screenshot", { screenshot });
    await page.screenshot({ path: screenshot, fullPage: true });
  } finally {
    console.debug("close browser");
    await context.close();
  }
})();
