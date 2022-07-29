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

  const browser = await chromium.launch({ headless: true });

  const context = await browser.newContext({
    baseURL: "https://moneyforward.com",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/104.0.5112.48 Safari/537.36",
  });

  const page = await context.newPage();
  await page.goto("/");

  await page.click('a[href="/sign_in"]');
  await page
    .locator(':nth-match(:text("メールアドレスでログイン"), 1)')
    .click();

  await page.fill('input[type="email"]', EMAIL);
  await page.click('input[type="submit"]');
  await page.waitForTimeout(500);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('input[type="submit"]');

  await page.goto("/accounts");

  const buttonSelector =
    'input:not(disabled)[type="submit"][name="commit"][value="更新"]';
  const buttonCount = await page.$$eval(
    buttonSelector,
    (buttons) => buttons.length
  );

  console.info("buttonCount", buttonCount);

  for (let i = 1; i <= buttonCount; i++) {
    const trSelector = `section#registration-table.accounts table#account-table tr:nth-child(${i})`;
    if (await page.$$eval(`${trSelector} ${buttonSelector}`, (l) => l.length)) {
      const account = await page.evaluate((sel) => {
        const element = document.querySelector(sel);
        if (element) {
          return element.textContent
            .replace(/\([\s\S]*/, "")
            .replace(/[\n\r]*/g, "");
        }
      }, `${trSelector} td:first-child`);

      console.info("account", account);

      if (SKIP_LIST.includes(account)) {
        console.info("skip", account);
        continue;
      }

      console.info("click", account);
      await page.click(`${trSelector} ${buttonSelector}`);
    }
  }

  await browser.close();
})();
