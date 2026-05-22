# yahoo-finance

Yahoo Finance の chart API のクライアント。

## 使用例

```ts
import { chart } from "./lib/yahoo-finance";

const resource = await chart.get("7203.T"); // 日本株 (トヨタ自動車)
const price = resource.meta?.regularMarketPrice;
```

## API

### `chart.get(symbol): Promise<ChartResource>`

Yahoo Finance から指定シンボルの直近相場データを取得する。

#### 引数

- `symbol`: Yahoo Finance のティッカーシンボル (例: 日本株 `7203.T`、為替 `USDJPY=X`、米国株 `AAPL`)

#### 戻り値

- `resource.meta.regularMarketPrice` (optional): 直近の取引価格
- `resource.meta.currency` (optional): 通貨コード (例: `JPY`)
- `resource.meta.symbol` (optional): API が返したシンボル

#### 例外を投げる条件

- HTTP ステータスが非 2xx
- レスポンスに `chart.error` が含まれる
- `chart.result` が空または欠落している
- レスポンスの形が宣言したスキーマと一致しない
