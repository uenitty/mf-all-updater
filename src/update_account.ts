// ref: https://github.com/kishikawakatsumi/mf-all-updater
import path from "node:path";

import { config } from "@dotenvx/dotenvx";
config();
import { google } from "googleapis";
import { chromium, errors } from "playwright";

import { files } from "./lib/slack";

const HEADLESS = process.env.HEADLESS || "";
const PLAYWRIGHT_LOGGER = process.env.PLAYWRIGHT_LOGGER || "";
const USER_DATA_DIR = "../user_data/";
const SCREENSHOT_DIR = "../screenshot/";

const EMAIL = process.env.EMAIL || "";
const PASSWORD = process.env.PASSWORD || "";
const SKIP_LIST = process.env.SKIP_LIST?.split(",") || [];

const GMAIL_CLIENT_ID = process.env.GMAIL_CLIENT_ID || "";
const GMAIL_CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET || "";
const GMAIL_REFRESH_TOKEN = process.env.GMAIL_REFRESH_TOKEN || "";

const SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID || "";
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN || "";

(async () => {
  if (!EMAIL || !PASSWORD) {
    console.error("Please set EMAIL and PASSWORD environment variables.");
    process.exitCode = 1;
    return;
  }

  console.debug({ HEADLESS, USER_DATA_DIR, SCREENSHOT_DIR, SKIP_LIST });

  console.debug("ブラウザを起動...");
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

    console.debug("口座ページにアクセス...");
    try {
      await page.goto("/accounts");
    } catch (error) {
      if (!(error instanceof errors.TimeoutError)) {
        throw error;
      }
      console.warn("口座ページへのアクセスがタイムアウト。到達確認...", error);
      await page
        .locator("section#registration-table.accounts table#account-table")
        .first()
        .waitFor({ state: "attached", timeout: 10 * 1000 });
      console.debug("到達確認。");
    }

    const maintenanceText = page.getByText("メンテナンス作業中です");
    console.debug("メンテナンス作業中か確認...");
    if (await maintenanceText.isVisible()) {
      console.error("🟡メンテナンス作業中のため中断。");
      return;
    }

    const loginLink = page.locator('a[href="/sign_in"]', {
      hasText: "ログイン",
    });
    console.debug("ログインリンクがあるか確認...");
    if (await loginLink.isVisible()) {
      console.debug("ログインリンクをクリック...");
      await Promise.all([page.waitForURL(/\/sign_in/), loginLink.click()]);
    }

    const loginWithEmailLink = page.locator('a[href^="/sign_in/email"]', {
      hasText: "メールアドレスでログイン",
    });
    console.debug("メールアドレスでログインリンクがあるか確認...");
    if (await loginWithEmailLink.isVisible()) {
      console.debug("メールアドレスでログインリンクをクリック...");
      await Promise.all([
        page.waitForURL(/\/sign_in/),
        loginWithEmailLink.click(),
      ]);
    }

    const emailInput = page.locator('input[type="email"]');
    const passwordInput = page.locator('input[type="password"]');
    console.debug("メールアドレスとパスワードの入力欄があるか確認...");
    if ((await emailInput.isVisible()) || (await passwordInput.isVisible())) {
      console.debug("メールアドレスを自動入力...");
      await emailInput.fill(EMAIL);
      console.debug("パスワードを自動入力...");
      await passwordInput.fill(PASSWORD);
      console.debug("メールアドレスとパスワードを送信...");
      await Promise.all([
        page.waitForURL(/\/sign_in/),
        passwordInput.press("Enter"),
      ]);
    }

    const additionalCertificationText = page.getByText("追加認証");
    console.debug("追加認証が必要か確認...");
    if (await additionalCertificationText.count()) {
      console.debug("追加認証が必要なことを検知。");
      const auth = new google.auth.OAuth2({
        clientId: GMAIL_CLIENT_ID,
        clientSecret: GMAIL_CLIENT_SECRET,
      });
      auth.setCredentials({ refresh_token: GMAIL_REFRESH_TOKEN });
      const gmail = google.gmail({ version: "v1", auth });
      for (let retryCount = 0; retryCount <= 10; retryCount += 1) {
        if (retryCount > 9) {
          console.error("🟡確認回数の上限のため中断。");
          process.exitCode = 1;
          return;
        }
        console.debug("追加認証のメールの受信を待機...");
        await page.waitForTimeout(3 * 1000);
        console.debug("追加認証のメールを受信しているか確認...", {
          retryCount,
        });
        const listMessageResponse = await gmail.users.messages.list({
          maxResults: 1,
          q: "from:(do_not_reply@moneyforward.com) 追加認証",
          userId: "me",
        });
        const messageId = listMessageResponse.data.messages?.at(0)?.id;
        if (!messageId) {
          console.debug("追加認証のメールは未受信。", {
            "listMessageResponse.status": listMessageResponse.status,
          });
          continue;
        }
        console.debug("追加認証のメール本文を取得...");
        const getMessageResponse = await gmail.users.messages.get({
          format: "raw",
          id: messageId,
          userId: "me",
        });
        if (getMessageResponse.status !== 200) {
          console.debug("取得時にエラーが発生。", {
            "getMessageResponse.status": getMessageResponse.status,
          });
          continue;
        }
        if (Number(getMessageResponse.data.internalDate) < startTimestamp) {
          console.debug("新しいメールではないことを検知。");
          continue;
        }
        console.debug("メール本文から認証コードを抽出...");
        const body = Buffer.from(
          getMessageResponse.data.raw ?? "",
          "base64",
        ).toString();
        const line = body
          .match(/^.*verification_code.*\b(\d{6})\b.*$/gm)
          ?.at(-1);
        const verificationCode = line?.match(/\d{6}/)?.at(0);
        if (!verificationCode) {
          console.debug("認証コードの取得に失敗。");
          continue;
        }
        console.debug("認証コードを取得。");
        const verificationCodeInput = page.getByRole("textbox");
        console.debug("認証コードを自動入力...");
        await verificationCodeInput.fill(verificationCode);
        console.debug("認証コードを送信...");
        try {
          await Promise.all([
            verificationCodeInput.waitFor({
              state: "hidden",
              timeout: 3 * 1000,
            }),
            verificationCodeInput.press("Enter"),
          ]);
        } catch (error) {
          console.debug("追加認証に失敗。", error);
          continue;
        }
        console.debug("追加認証に成功。");
        break;
      }
    }

    console.debug("口座ページにアクセス...");
    try {
      await page.goto("/accounts");
    } catch (error) {
      if (!(error instanceof errors.TimeoutError)) {
        throw error;
      }
      console.warn("口座ページへのアクセスがタイムアウト。到達確認...", error);
      await page
        .locator("section#registration-table.accounts table#account-table")
        .first()
        .waitFor({ state: "attached", timeout: 10 * 1000 });
      console.debug("到達確認。");
    }

    const useThisAccountButton = page.getByRole("button", {
      name: "このアカウントを使用する",
    });
    console.debug("このアカウントを使用するボタンがあるか確認...");
    if (await useThisAccountButton.isVisible()) {
      console.debug("このアカウントを使用するボタンをクリック...");
      await Promise.all([
        page.waitForURL(/\/accounts/),
        useThisAccountButton.click(),
      ]);
    }

    const selectThisAccountButton = page.getByRole("button", {
      name: "メールアドレスでログイン",
    });
    console.debug("メールアドレスでログインボタンがあるか確認...");
    if (await selectThisAccountButton.isVisible()) {
      console.debug("メールアドレスでログインボタンをクリック...");
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

    console.debug("口座名を取得...");
    const accountNames = (
      await Promise.all(
        (await rows.locator("td:first-child a:first-child").all()).map(
          (firstChild) => firstChild.textContent(),
        ),
      )
    ).map((accountName) => accountName ?? "");
    console.debug("口座名", accountNames);

    for (const accountName of accountNames) {
      if (SKIP_LIST.includes(accountName)) {
        console.info("ℹ️スキップ", accountName);
        continue;
      }

      const row = rows.filter({ hasText: accountName });

      if (await row.getByRole("button", { name: "更新" }).isDisabled()) {
        console.info("ℹ️更新不可", accountName);
        continue;
      }

      const form = row.locator("form", {
        has: page.getByRole("button", { name: "更新" }),
      });
      const updateButton = form.getByRole("button", { name: "更新" });
      const action = await form.getAttribute("action");
      console.info("ℹ️更新...", accountName);
      await Promise.all([
        page.waitForResponse(action ?? ""),
        updateButton.click(),
      ]);
    }
  } catch (error) {
    console.error("🔴エラーが発生。");
    console.error(error);
    process.exitCode = 1;

    const screenshotName = new Date()
      .toLocaleString("ja-JP", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
        timeZone: "Asia/Tokyo",
        timeZoneName: "short",
      })
      .replaceAll("/", "-")
      .replaceAll(":", "-")
      .replaceAll(" ", "_");
    const filename = `${screenshotName}.png`;
    const screenshot = path.join(__dirname, SCREENSHOT_DIR, filename);
    console.debug("デバッグ用にスクリーンショットを撮影...", { screenshot });
    const buffer = await page.screenshot({ path: screenshot, fullPage: true });

    console.debug("Using Bot Token:", SLACK_BOT_TOKEN ? "SET" : "NOT SET");
    console.debug("Slackにファイルを送信...");
    await files.upload({
      filename,
      buffer,
      channelId: SLACK_CHANNEL_ID,
      initialComment: "Account Update: エラーが発生。",
      botToken: SLACK_BOT_TOKEN,
    });
    console.debug("Slackにファイルを送信。");
  } finally {
    console.debug("ブラウザを終了...");
    await context.close();

    switch (process.exitCode) {
      case undefined:
      case 0:
        console.info("結果: 🟢成功。");
        break;
      case 1:
        console.info("結果: 🔴失敗。");
        break;
      default:
        console.info("結果: 🔴不明なエラーで失敗。");
    }
  }
})();
