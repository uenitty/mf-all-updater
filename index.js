// ref: https://github.com/kishikawakatsumi/mf-all-updater

require("dotenv").config();
const { chromium } = require("playwright");

const EMAIL = process.env.EMAIL || "";
const PASSWORD = process.env.PASSWORD || "";
const SKIP_LIST = process.env.SKIP_LIST?.split(",") || [];

(async () => {
  if (!EMAIL || !PASSWORD) {
    console.error("Please set EMAIL and PASSWORD environment variables.");
    process.exitCode = 1;
    return;
  }

  console.debug("launch browser");
  const browser = await chromium.launch({ headless: true });

  const context = await browser.newContext({
    baseURL: "https://moneyforward.com",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/104.0.5112.48 Safari/537.36",
  });

  const page = await context.newPage();

  console.debug("goto /accounts");
  await page.goto("/accounts");

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

  try {
    const emailInput = page.locator('input[type="email"]');
    const passwordInput = page.locator('input[type="password"]');
    console.debug("fill EMAIL");
    await emailInput.fill(EMAIL);
    console.debug("fill PASSWORD");
    await passwordInput.fill(PASSWORD);
    console.debug("submit EMAIL and PASSWORD");
    await Promise.all([
      page.waitForURL(/\/sign_in/),
      passwordInput.press("Enter"),
    ]);
  } catch (error) {
    console.error("page.content()\n-----\n", await page.content(), "\n-----");
    throw error;
  }

  console.debug("goto /accounts");
  await page.goto("/accounts");

  const useThisAccountButton = page.locator("button", {
    hasText: "このアカウントを使用する",
  });
  if (await useThisAccountButton.count()) {
    console.debug("click このアカウントを使用する");
    await Promise.all([
      page.waitForURL(/\/accounts/),
      useThisAccountButton.click(),
    ]);
  }

  const rows = page
    .locator("section#registration-table.accounts table#account-table tr")
    .filter({
      has: page.locator('form input[value="更新"]'),
    });

  const count = await rows.count();
  console.debug("count", count);

  for (let i = 0; i < count; i++) {
    try {
      const row = rows.nth(i);

      const accountName = await row
        .locator("td:first-child a:first-child")
        .textContent();

      if (SKIP_LIST.includes(accountName)) {
        console.info(i, "skip", accountName);
        continue;
      }

      console.info(i, "update", accountName);
      const form = row.locator("form", {
        has: page.locator('input[value="更新"]'),
      });
      const action = await form.getAttribute("action");
      await Promise.all([
        page.waitForResponse(action),
        form.locator('input[value="更新"]').click(),
      ]);
    } catch (error) {
      console.error(`caught error at ${i}th row`);
      console.error("::group::page.content()");
      console.error(await page.content());
      console.error("::endgroup::");
      throw error;
    }
  }

  console.debug("close browser");
  await context.close();
  await browser.close();
})();
