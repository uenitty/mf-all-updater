// ref: https://github.com/kishikawakatsumi/mf-all-updater

require("dotenv").config();
const { chromium } = require("playwright");

const HEADLESS = process.env.HEADLESS || "";
const EMAIL = process.env.EMAIL || "";
const PASSWORD = process.env.PASSWORD || "";
const SKIP_LIST = process.env.SKIP_LIST?.split(",") || [];

(async () => {
  if (!EMAIL || !PASSWORD) {
    console.error("Please set EMAIL and PASSWORD environment variables.");
    process.exitCode = 1;
    return;
  }

  console.debug({ HEADLESS });

  console.debug("launch browser");
  const browser = await chromium.launch({ headless: HEADLESS === "true" });

  const context = await browser.newContext({
    baseURL: "https://moneyforward.com",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/104.0.5112.48 Safari/537.36",
  });

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
    console.debug("fill EMAIL");
    await emailInput.fill(EMAIL);
    console.debug("fill PASSWORD");
    await passwordInput.fill(PASSWORD);
    console.debug("submit EMAIL and PASSWORD");
    await Promise.all([
      page.waitForURL(/\/sign_in/),
      passwordInput.press("Enter"),
    ]);

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

    const rows = page
      .locator("section#registration-table.accounts table#account-table tr")
      .filter({
        has: page.getByRole("button", { name: "更新" }),
      });

    const accountNames = await Promise.all(
      (await rows.locator("td:first-child a:first-child").all()).map(
        (firstChild) => firstChild.textContent(),
      ),
    );
    console.debug("accountNames", accountNames);

    for (let accountName of accountNames) {
      if (SKIP_LIST.includes(accountName)) {
        console.info("skip", accountName);
        continue;
      }

      console.info("update", accountName);
      const form = rows.filter({ hasText: accountName }).locator("form", {
        has: page.getByRole("button", { name: "更新" }),
      });
      const updateButton = form.getByRole("button", { name: "更新" });
      await updateButton.waitFor();
      if (await updateButton.isDisabled()) {
        console.info("disabled", accountName);
        continue;
      }
      const action = await form.getAttribute("action");
      await Promise.all([page.waitForResponse(action), updateButton.click()]);
    }
  } catch (error) {
    console.error(error);
    process.exitCode = 1;

    console.error("::group::page.content()");
    console.error(await page.content());
    console.error("::endgroup::");
  } finally {
    console.debug("close browser");
    await context.close();
    await browser.close();
  }
})();
