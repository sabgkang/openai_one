# OpenAI One — 多帳號 ChatGPT 訂閱 API Gateway

將多個 ChatGPT Plus/Pro 帳號整合為單一 OpenAI 相容的 API 端點，自動輪替帳號並處理使用量限制。

---

## 架構說明

```
你的程式 (OpenAI SDK)
    ↓  POST /v1/chat/completions
Express Gateway (localhost:3000)
    ↓  輪替帳號 + 自動刷新 Token
chatgpt.com/backend-api/codex/responses
    ↓  使用 ChatGPT 訂閱計費（非 API Credits）
```

> **重要**：本 Gateway 使用 ChatGPT 訂閱額度，**不需要** OpenAI API Credits。

---

## 安裝

### 1. 安裝 Node.js 依賴

```bash
cd openai_one
npm install
```

### 2. 建立環境設定檔

```bash
cp .env.example .env
```

`.env` 可調整的參數：

```env
PORT=3000                        # 監聽 port（預設 3000）
DEFAULT_RATE_LIMIT_SECONDS=60    # 帳號達到限制後封鎖秒數
MAX_RETRIES=3                    # 單次請求最多嘗試幾個帳號
```

---

## 新增帳號

本 Gateway 使用 OAuth Token 授權，**不是** API Key。Token 來源有兩種方式：

### 方式一：從現有 auth 檔案匯入（推薦）

如果你已有 OpenCode、Hermes、或 Codex CLI 產生的 auth 檔案：

```bash
npm run import-account "帳號名稱" ./path/to/auth.json
```

支援的 auth 檔案格式：
- **OpenCode / Hermes 格式**：`providers["openai-codex"].tokens.access_token`
- **Codex CLI 格式**（`~/.codex/auth.json`）：直接執行不指定路徑即可自動偵測

```bash
# 自動搜尋 ~/.codex/auth.json
npm run import-account "我的帳號"

# 指定自訂路徑
npm run import-account "帳號A" ./hdd0_auth.json
```

### 方式二：裝置授權流程（需要網路可直連 auth.openai.com）

```bash
npm run add-account "帳號名稱"
```

瀏覽器開啟顯示的網址，登入 ChatGPT 帳號完成授權。

> **注意**：若 `auth.openai.com` 被 Cloudflare 擋住，請改用方式一。

---

## 啟動伺服器

### 一般啟動（自動輪替所有帳號）

```bash
npm start
```

### 查看所有帳號狀態

```bash
npm start -- --list
```

輸出範例：
```
共有 2 個帳號：

  1. hdd7
     last used 4/21/2026, 3:00:00 PM  token expires 4/30/2026, 10:30:46 AM

  2. account2  [rate limited]
     last used 4/21/2026, 2:55:00 PM  token expires 5/1/2026, 9:00:00 AM
```

### 強制使用指定帳號

```bash
npm start -- --account hdd7
```

指定的帳號名稱必須與匯入時使用的名稱完全相符。若帳號不存在，伺服器會在啟動時立即報錯並列出現有帳號。

---

## 使用方式

### curl（WSL / Linux / macOS）

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-5.4-mini","messages":[{"role":"user","content":"Hello"}]}'
```

### OpenAI Python SDK

```python
from openai import OpenAI

client = OpenAI(
    api_key="dummy",           # 任意字串即可，Gateway 不驗證
    base_url="http://localhost:3000/v1"
)

response = client.chat.completions.create(
    model="gpt-5.4-mini",
    messages=[{"role": "user", "content": "Hello"}]
)
print(response.choices[0].message.content)
```

### OpenAI Node.js SDK

```javascript
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: 'dummy',
  baseURL: 'http://localhost:3000/v1',
});

const response = await client.chat.completions.create({
  model: 'gpt-5.4-mini',
  messages: [{ role: 'user', content: 'Hello' }],
});
console.log(response.choices[0].message.content);
```

### Streaming

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-5.4-mini","messages":[{"role":"user","content":"Hello"}],"stream":true}'
```

---

## 可用模型

| 模型名稱 | 需求 | 說明 |
|---|---|---|
| `gpt-5.4-mini` | 免費版 / Plus | 快速，適合一般任務 |
| `gpt-5.4` | Plus / Pro | 旗艦模型 |
| `codex-mini-latest` | Plus（Codex 訂閱）| 針對程式碼優化 |

---

## 健康檢查

```bash
curl http://localhost:3000/health
```

回傳所有帳號的目前狀態（rate limit、token 到期時間、最後使用時間）。

---

## 注意事項

### Token 安全
- `data/accounts.json` 含有 OAuth Token，**請勿 commit 至 git**（已加入 `.gitignore`）
- Token 效期約 10 天，過期後系統會自動用 `refresh_token` 換新

### Rate Limit 行為
- 收到 `429` 回應時，該帳號會被暫時封鎖（預設 60 秒，或依 API 回傳的 `retry-after`）
- 封鎖期間自動切換到下一個帳號
- 重啟伺服器會清除所有記憶體中的 rate limit 狀態

### WSL 使用者
從 WSL 連接 Windows 上的 Gateway，需使用 Windows host IP：

```bash
HOST=$(ip route show default | awk '{print $3}')
curl http://$HOST:3000/v1/chat/completions ...
```

首次使用需在 Windows PowerShell（系統管理員）開放防火牆：

```powershell
New-NetFirewallRule -DisplayName "Codex Gateway 3000" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow
```

### ChatGPT 訂閱方案
- **免費版**：可使用 `gpt-5.4-mini`，有每日使用上限
- **Plus / Pro**：可使用全部模型，上限更高
- 本 Gateway **不消耗** OpenAI API Credits，使用的是 ChatGPT 訂閱額度
