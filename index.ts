// ref: https://github.com/kishikawakatsumi/mf-all-updater

import { config } from "@dotenvx/dotenvx";
config();

import path from "path";

import { google } from "googleapis";
import { chromium } from "playwright";

const HEADLESS = process.env.HEADLESS || "";
const PLAYWRIGHT_LOGGER = process.env.PLAYWRIGHT_LOGGER || "";
const USER_DATA_DIR = "./user_data/";
const SCREENSHOT_DIR = "./screenshot/";

const EMAIL = process.env.EMAIL || "";
const PASSWORD = process.env.PASSWORD || "";
const SKIP_LIST = process.env.SKIP_LIST?.split(",") || [];

const GMAIL_CLIENT_ID = process.env.GMAIL_CLIENT_ID || "";
const GMAIL_CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET || "";
const GMAIL_REFRESH_TOKEN = process.env.GMAIL_REFRESH_TOKEN || "";

(async () => {
  if (!EMAIL || !PASSWORD) {
    console.error("Please set EMAIL and PASSWORD environment variables.");
    process.exitCode = 1;
    return;
  }

  console.debug({ HEADLESS, USER_DATA_DIR, SCREENSHOT_DIR, SKIP_LIST });

  console.debug("launch browser");
  const context = await chromium.launchPersistentContext(
    path.join(__dirname, USER_DATA_DIR),
    {
      baseURL: "https://moneyforward.com",
      channel: "chromium",
      headless: HEADLESS === "true",
      locale: "ja-JP",
      logger: {
        isEnabled: (_name, _severity) => PLAYWRIGHT_LOGGER === "true",
        log: (name, severity, message, args, hints) =>
          console.log(`${name} [${severity}] ${message}`, { args, hints }),
      },
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    },
  );

  const page = await context.newPage();

  try {
    const startTimestamp = Date.now();
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
      console.debug("detected 追加認証");
      const auth = new google.auth.OAuth2({
        clientId: GMAIL_CLIENT_ID,
        clientSecret: GMAIL_CLIENT_SECRET,
      });
      auth.setCredentials({ refresh_token: GMAIL_REFRESH_TOKEN });
      const gmail = google.gmail({ version: "v1", auth });
      for (let retryCount = 0; true; retryCount += 1) {
        console.debug("fetch email", { retryCount });
        const listMessageResponse = await gmail.users.messages.list({
          maxResults: 1,
          q: "from:(do_not_reply@moneyforward.com) 追加認証",
          userId: "me",
        });
        const messageId = listMessageResponse.data.messages?.at(0)?.id;
        if (!messageId) {
          console.debug("message not found.", {
            "listMessageResponse.status": listMessageResponse.status,
          });
          await page.waitForTimeout(3 * 1000);
          continue;
        }
        const getMessageResponse = await gmail.users.messages.get({
          format: "raw",
          id: messageId,
          userId: "me",
        });
        if (getMessageResponse.status !== 200) {
          console.debug("error.", {
            "getMessageResponse.status": getMessageResponse.status,
          });
          await page.waitForTimeout(3 * 1000);
          continue;
        }
        if (Number(getMessageResponse.data.internalDate) < startTimestamp) {
          console.debug("new message not found.");
          await page.waitForTimeout(3 * 1000);
          continue;
        }
        const body = Buffer.from(
          getMessageResponse.data.raw ?? "",
          "base64",
        ).toString();
        const line = body
          .match(/^.*verification_code.*\b(\d{6})\b.*$/gm)
          ?.at(-1);
        const verificationCode = line?.match(/\d{6}/)?.at(0);
        if (verificationCode) {
          const verificationCodeInput = page.getByRole("textbox");
          console.debug("fill verificationCode");
          await verificationCodeInput.fill(verificationCode);
          console.debug("submit verificationCode");
          await Promise.all([
            verificationCodeInput.waitFor({ state: "hidden" }),
            verificationCodeInput.press("Enter"),
          ]);
          break;
        }
        if (retryCount >= 10) {
          console.error("timeout.");
          process.exitCode = 1;
          return;
        }
        await page.waitForTimeout(3 * 1000);
      }
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

    const rows = page
      .locator("section#registration-table.accounts table#account-table tr")
      .filter({
        has: page.getByRole("button", { name: "更新" }),
      });

    const accountNames = (
      await Promise.all(
        (await rows.locator("td:first-child a:first-child").all()).map(
          (firstChild) => firstChild.textContent(),
        ),
      )
    ).map((accountName) => accountName ?? "");
    console.debug("accountNames", accountNames);

    for (const accountName of accountNames) {
      if (SKIP_LIST.includes(accountName)) {
        console.info("skip", accountName);
        continue;
      }

      const row = rows.filter({ hasText: accountName });

      if (await row.getByRole("button", { name: "更新" }).isDisabled()) {
        console.info("disabled", accountName);
        continue;
      }

      const form = row.locator("form", {
        has: page.getByRole("button", { name: "更新" }),
      });
      const updateButton = form.getByRole("button", { name: "更新" });
      const action = await form.getAttribute("action");
      console.info("update", accountName);
      await Promise.all([
        page.waitForResponse(action ?? ""),
        updateButton.click(),
      ]);
    }
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
