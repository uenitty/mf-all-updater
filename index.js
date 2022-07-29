// ref: https://github.com/kishikawakatsumi/mf-all-updater

require("dotenv").config();
const { chromium } = require("playwright");

(async () => {
  const EMAIL = process.env.EMAIL || "";
  const PASSWORD = process.env.PASSWORD || "";
  const SKIP_LIST = ["Amazon.co.jp"];

  if (!EMAIL || !PASSWORD) {
    console.error("Please set EMAIL and PASSWORD environment variables.");
    process.exit(1);
  }

  console.debug("launch browser");
  const browser = await chromium.launch({ headless: true });

  const context = await browser.newContext({
    baseURL: "https://moneyforward.com",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/104.0.5112.48 Safari/537.36",
  });

  const page = await context.newPage();

  console.debug("goto /");
  await page.goto("/");

  console.debug("click ログイン");
  await page
    .locator('a[href="/sign_in"]', {
      hasText: "ログイン",
    })
    .click();

  console.debug("click メールアドレスでログイン");
  await page
    .locator('a[href^="/sign_in/email"]', {
      hasText: "メールアドレスでログイン",
    })
    .click();

  console.debug("fill EMAIL");
  await page.locator('input[type="email"]').fill(EMAIL);
  console.debug("click EMAIL submit");
  await Promise.all([
    page.waitForNavigation(),
    page.locator('input[type="submit"]').click(),
  ]);
  console.debug("fill PASSWORD");
  await page.locator('input[type="password"]').fill(PASSWORD);
  console.debug("click PASSWORD submit");
  await page.locator('input[type="submit"]').click();

  console.debug("goto /accounts");
  await page.goto("/accounts");

  const rows = page
    .locator("section#registration-table.accounts table#account-table tr")
    .filter({
      has: page.locator('form input[value="更新"]'),
    });

  const count = await rows.count();
  console.debug("count", count);

  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);

    const accountName = await row
      .locator("td:first-child a:first-child")
      .textContent();

    if (SKIP_LIST.includes(accountName)) {
      console.info(i, "skip", accountName);
      continue;
    }

    console.info(i, "update", accountName);
    await row.locator('form input[value="更新"]').click();
  }

  console.debug("close browser");
  await browser.close();
})();
