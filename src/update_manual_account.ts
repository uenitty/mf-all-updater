import path from "node:path";

import { config } from "@dotenvx/dotenvx";
config();
import { google } from "googleapis";
import { chromium } from "playwright";

import { files } from "./lib/slack";
import { chart } from "./lib/yahoo-finance";

const HEADLESS = process.env.HEADLESS || "";
const PLAYWRIGHT_LOGGER = process.env.PLAYWRIGHT_LOGGER || "";
const USER_DATA_DIR = "../user_data/";
const SCREENSHOT_DIR = "../screenshot/";

const EMAIL = process.env.EMAIL || "";
const PASSWORD = process.env.PASSWORD || "";
const MANUAL_ACCOUNT_NAME = process.env.MANUAL_ACCOUNT_NAME || ""; // 口座名
const SYMBOL = process.env.SYMBOL || ""; // 銘柄コード
const PORTAL_URL = process.env.PORTAL_URL || "";
const PORTAL_CODE = process.env.PORTAL_CODE || "";
const PORTAL_ID = process.env.PORTAL_ID || "";
const PORTAL_PASSWORD = process.env.PORTAL_PASSWORD || "";

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

  console.debug({ HEADLESS, USER_DATA_DIR, SCREENSHOT_DIR });

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
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/104.0.5112.48 Safari/537.36",
    },
  );
  const page = await context.newPage();

  try {
    console.debug("ポータルページにアクセス...");
    await page.goto(PORTAL_URL);

    const outOfServiceText =
      page.getByText("一時的にサービスを停止しております");
    console.debug("一時的なサービス停止中か確認...");
    if (await outOfServiceText.count()) {
      console.error("🟡一時的なサービス停止中のため中断。");
      return;
    }

    const iframe = page.locator("#iframe");
    const portalForm = iframe.contentFrame().locator("#form");
    const portalCodeInput = portalForm.locator('input[id$="Cd"]');
    const portalIdInput = portalForm.locator('input[id="loginId"]');
    const portalPasswordInput = portalForm.locator('input[type="password"]');
    console.debug("ポータルコードを自動入力...");
    await portalCodeInput.fill(PORTAL_CODE);
    console.debug("IDを自動入力...");
    await portalIdInput.fill(PORTAL_ID);
    console.debug("パスワードを自動入力...");
    await portalPasswordInput.fill(PORTAL_PASSWORD);
    console.debug("ログイン情報を送信...");
    await Promise.all([
      Promise.race([
        page.waitForURL(/\/membertop/),
        iframe
          .contentFrame()
          .getByText("ただいまサービスのご利用可能時間外です")
          .waitFor({ state: "visible" }),
      ]),
      portalPasswordInput.press("Enter"),
    ]);

    console.debug("サービス利用可能時間外か確認...");
    if (await iframe.isVisible()) {
      const outsideHoursText = iframe
        .contentFrame()
        .getByText("ただいまサービスのご利用可能時間外です");
      if (await outsideHoursText.count()) {
        console.error("🟡サービス利用可能時間外のため中断。");
        return;
      }
    }

    console.debug("詳細ページへ遷移...");
    await page.getByRole("link").getByText("持株会", { exact: true }).click();
    await page.getByRole("link", { name: "拠出状況照会" }).first().click();
    await page.locator("div.loading-div").waitFor({ state: "hidden" });

    console.debug("get numberOfShares and bvps");
    const [numberOfSharesRowString, bvpsRowString] = await Promise.all([
      await page
        .getByRole("listitem")
        .filter({ hasText: "保有株数" })
        .innerText(),
      await page
        .getByRole("listitem")
        .filter({ hasText: "簿価単価" })
        .innerText(),
    ]);

    // 保有株数
    const numberOfShares = Number(
      numberOfSharesRowString
        .replace(/\n/g, "")
        .replace(/,/g, "")
        .match(/保有株数(.*)株/)
        ?.at(1),
    );
    // 簿価単価
    const bvps = Number(
      bvpsRowString
        .replace(/\n/g, "")
        .replace(/,/g, "")
        .match(/簿価単価(.*)円/)
        ?.at(1),
    );

    if (
      !Number.isFinite(numberOfShares) ||
      numberOfShares <= 0 ||
      !Number.isFinite(bvps) ||
      bvps <= 0
    ) {
      console.error("numberOfShares or bvps is invalid.");
      process.exitCode = 1;
      return;
    }

    const startTimestamp = Date.now();

    console.debug("口座ページにアクセス...");
    await page.goto("/accounts");

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
    await page.goto("/accounts");

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

    console.debug("口座名をクリック...");
    await Promise.all([
      page.waitForURL(/\/accounts\/show_manual.*/),
      page.getByRole("link", { name: MANUAL_ACCOUNT_NAME }).click(),
    ]);

    console.debug("変更をクリック...");
    await page.getByAltText("変更").click();

    console.debug("現在の株価を取得...");
    const chartResource = await chart.get(SYMBOL);
    const regularMarketPrice = chartResource.meta?.regularMarketPrice;

    if (
      regularMarketPrice === undefined ||
      !Number.isFinite(regularMarketPrice) ||
      regularMarketPrice <= 0
    ) {
      console.error("🟡現在の株価が無効なため中断。");
      process.exitCode = 1;
      return;
    }

    console.debug("現在の価値を自動入力...");
    await page
      .getByText("現在の価値")
      .locator("..")
      .getByRole("textbox")
      .fill(`${Math.round(regularMarketPrice * numberOfShares)}`);

    console.debug("購入価格を自動入力...");
    await page
      .getByText("購入価格")
      .locator("..")
      .getByRole("textbox")
      .fill(`${Math.round(bvps * numberOfShares)}`);

    console.debug("この内容で登録するボタンをクリック...");
    await Promise.all([
      page.waitForURL(/\/accounts\/show_manual.*/),
      page.getByRole("button", { name: "この内容で登録する" }).click(),
    ]);
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
