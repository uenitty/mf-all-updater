# slack

Slack Web API のクライアント。

## 使用例

```ts
import { files } from "./lib/slack";

await files.upload({
  filename: "screenshot.png",
  buffer,
  channelId: SLACK_CHANNEL_ID,
  initialComment: "エラーが発生しました。",
  botToken: SLACK_BOT_TOKEN,
});
```

## API

### `files.upload(params): Promise<void>`

Slack のチャンネルにファイルをアップロードする。

#### 引数

- `filename`: ファイル名
- `buffer`: アップロードするバイト列
- `channelId`: 投稿先チャンネル ID
- `initialComment`: ファイルに添えるコメント
- `botToken`: `files:write` スコープを付与した Bot トークン

#### 戻り値

- アップロード完了時に解決する `Promise<void>`

#### 例外を投げる条件

- HTTP ステータスが非 2xx
- Slack API が `ok: false` を返す
- レスポンスの形が宣言したスキーマと一致しない
