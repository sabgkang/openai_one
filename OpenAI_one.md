此程式及說明都是用 Claude Code 寫的，說明有加上一些人工修改。

\---

# **OpenAI One — 多帳號 ChatGPT 訂閱 API Gateway**

[](https://github.com/sabgkang/openai_one/blob/master/OpenAI_one.md#openai-one--%E5%A4%9A%E5%B8%B3%E8%99%9F-chatgpt-%E8%A8%82%E9%96%B1-api-gateway)

將多個 ChatGPT Plus/Pro 帳號整合為單一 OpenAI 相容的 API 端點，自動輪替帳號並處理使用量限制。

* * *

## **架構說明**

[](https://github.com/sabgkang/openai_one/blob/master/OpenAI_one.md#%E6%9E%B6%E6%A7%8B%E8%AA%AA%E6%98%8E)

```
你的程式 (OpenAI SDK)
    ↓  POST /v1/chat/completions
Express Gateway (localhost:3000)
    ↓  輪替帳號 + 自動刷新 Token
chatgpt.com/backend-api/codex/responses
    ↓  使用 ChatGPT 訂閱計費（非 API Credits）

```

> **重要**：本 Gateway 使用 ChatGPT 訂閱額度，**不需要** OpenAI API Key Credits。

> **以下示範範例是在 PC4090 的 PowerShell 環境下**

## **安裝**

[](https://github.com/sabgkang/openai_one/blob/master/OpenAI_one.md#%E5%AE%89%E8%A3%9D)

### **1\. 安裝 Node.js 依賴**

[](https://github.com/sabgkang/openai_one/blob/master/OpenAI_one.md#1-%E5%AE%89%E8%A3%9D-nodejs-%E4%BE%9D%E8%B3%B4)

cd openai\_one
npm install

### **2\. 建立環境設定檔**

[](https://github.com/sabgkang/openai_one/blob/master/OpenAI_one.md#2-%E5%BB%BA%E7%AB%8B%E7%92%B0%E5%A2%83%E8%A8%AD%E5%AE%9A%E6%AA%94)

copy .env.example .env

`.env` 可調整的參數：

PORT=3000                        # 監聽 port（預設 3000）
DEFAULT\_RATE\_LIMIT\_SECONDS=60    # 帳號達到限制後封鎖秒數
MAX\_RETRIES=3                    # 單次請求最多嘗試幾個帳號

* * *

## **新增帳號**

[](https://github.com/sabgkang/openai_one/blob/master/OpenAI_one.md#%E6%96%B0%E5%A2%9E%E5%B8%B3%E8%99%9F)

本 Gateway 使用 OAuth Token 授權，**不是** API Key。

> 本想用 codex 或是 Hermes Agent 那種提供 openai login url 和裝置代碼，然後手動打開 Chrome，登入 OpenAI Codex，接著輸入裝置代碼，即可完成授權。
> 
> 但一開始就遇到很奇怪的 Cloudflare 保護機制，所以就放棄了。

### **移花接木 - 從現有 auth 檔案匯入**

[](https://github.com/sabgkang/openai_one/blob/master/OpenAI_one.md#%E6%96%B9%E5%BC%8F%E4%B8%80%E5%BE%9E%E7%8F%BE%E6%9C%89-auth-%E6%AA%94%E6%A1%88%E5%8C%AF%E5%85%A5%E6%8E%A8%E8%96%A6)

可以使用 OpenCode、Hermes、或 Codex CLI 產生的 auth 檔案，例如在 PC4090 的 Hermes Agent 有取得 OpenAI Codex HDD7 (kang.hdd7@gmail.com) 的授權，存在 ~/.hermers/auth.json。

> Hermes 只有一個 auth.json，當登入另外一個帳號並取得授權後，就會把原先舊的蓋掉。

copy ~/.hermers/auth.json ./hdd7\_auth.json  
npm run import-account "HDD7" ./hdd7\_auth.json

> “HDD7” 為任意自取，不必跟 OpenAI 帳號一樣。

## **啟動伺服器**

[](https://github.com/sabgkang/openai_one/blob/master/OpenAI_one.md#%E5%95%9F%E5%8B%95%E4%BC%BA%E6%9C%8D%E5%99%A8)

### **一般啟動（自動輪替所有帳號）**

[](https://github.com/sabgkang/openai_one/blob/master/OpenAI_one.md#%E4%B8%80%E8%88%AC%E5%95%9F%E5%8B%95%E8%87%AA%E5%8B%95%E8%BC%AA%E6%9B%BF%E6%89%80%E6%9C%89%E5%B8%B3%E8%99%9F)

npm start or  
node src\\server.js

### **查看所有帳號狀態**

[](https://github.com/sabgkang/openai_one/blob/master/OpenAI_one.md#%E6%9F%A5%E7%9C%8B%E6%89%80%E6%9C%89%E5%B8%B3%E8%99%9F%E7%8B%80%E6%85%8B)

npm start -- --list or  
node src\\server.js --list

輸出範例：

```
共有 2 個帳號：

  1. hdd7
     last used 4/21/2026, 3:00:00 PM  token expires 4/30/2026, 10:30:46 AM

  2. account2  [rate limited]
     last used 4/21/2026, 2:55:00 PM  token expires 5/1/2026, 9:00:00 AM

```

### **強制使用指定帳號**

[](https://github.com/sabgkang/openai_one/blob/master/OpenAI_one.md#%E5%BC%B7%E5%88%B6%E4%BD%BF%E7%94%A8%E6%8C%87%E5%AE%9A%E5%B8%B3%E8%99%9F)

npm start -- --account hdd7 or  
node src\\server.js

指定的帳號名稱必須與匯入時使用的名稱完全相符。若帳號不存在，伺服器會在啟動時立即報錯並列出現有帳號。

## **使用方式 :** 

> **PowerShell 使用 curl 問題多多，所以 Windows 系統下，建議使用 WSL**

[](https://github.com/sabgkang/openai_one/blob/master/OpenAI_one.md#%E4%BD%BF%E7%94%A8%E6%96%B9%E5%BC%8F)

### **curl（WSL in PC4090）**

[](https://github.com/sabgkang/openai_one/blob/master/OpenAI_one.md#curlwsl--linux--macos)

curl http://localhost:3000/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{"model":"gpt-5.4-mini","messages":\[{"role":"user","content":"Hello"}\]}'

### **OpenAI Python SDK**

[](https://github.com/sabgkang/openai_one/blob/master/OpenAI_one.md#openai-python-sdk)

from openai import OpenAI

client = OpenAI(
    api\_key\="dummy",           # 任意字串即可，Gateway 不驗證
    base\_url\="http://localhost:3000/v1"
)

response = client.chat.completions.create(
    model\="gpt-5.4-mini",
    messages\=\[{"role": "user", "content": "Hello"}\]
)
print(response.choices\[0\].message.content)

### **OpenAI Node.js SDK**

[](https://github.com/sabgkang/openai_one/blob/master/OpenAI_one.md#openai-nodejs-sdk)

import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: 'dummy',
  baseURL: 'http://localhost:3000/v1',
});

const response = await client.chat.completions.create({
  model: 'gpt-5.4-mini',
  messages: \[{ role: 'user', content: 'Hello' }\],
});
console.log(response.choices\[0\].message.content);

### **Streaming**

[](https://github.com/sabgkang/openai_one/blob/master/OpenAI_one.md#streaming)

curl http://localhost:3000/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{"model":"gpt-5.4-mini","messages":\[{"role":"user","content":"Hello"}\],"stream":true}'

> SDK 的 base\_url 只設到 /v1，完整路徑由 SDK 自動組合：
> 
>  base\_url = "http://localhost:3000/v1"  
>  client.chat.completions.create(...)  
>  → 實際呼叫 http://localhost:3000/v1/chat/completions
> 
> curl 則需要自己寫完整路徑，所以要加 /chat/completions。兩者最終打到的 URL 是一樣的。

## **可用模型**

免費版帳號，從 Hermes → Telegram bot → /model 可看到有七個 OpenAI Codex 模型，但實測只有 只有 `gpt5.4, gpt-5.4-mini, gpt-5.3-codex` 可以用。其他模型不支持。

<img src="api/attachments/PeByzG1eUxzs/image/image.png" width="269" height="357">

[](https://github.com/sabgkang/openai_one/blob/master/OpenAI_one.md#%E5%8F%AF%E7%94%A8%E6%A8%A1%E5%9E%8B)

| 模型名稱 | 需求  | 說明  |
| --- | --- | --- |
| `gpt-5.4-mini` | 免費版 / Plus | 快速，適合一般任務 |
| `gpt-5.4` | Plus / Pro | 旗艦模型 |
| `codex-mini-latest` | Plus（Codex 訂閱） | 針對程式碼優化 |

* * *

## **健康檢查**

[](https://github.com/sabgkang/openai_one/blob/master/OpenAI_one.md#%E5%81%A5%E5%BA%B7%E6%AA%A2%E6%9F%A5)

curl http://localhost:3000/health

回傳所有帳號的目前狀態（rate limit、token 到期時間、最後使用時間）。

* * *

## **注意事項**

[](https://github.com/sabgkang/openai_one/blob/master/OpenAI_one.md#%E6%B3%A8%E6%84%8F%E4%BA%8B%E9%A0%85)

### **Token 安全**

[](https://github.com/sabgkang/openai_one/blob/master/OpenAI_one.md#token-%E5%AE%89%E5%85%A8)

*   `data/accounts.json` 含有 OAuth Token，**請勿 commit 至 git**（已加入 `.gitignore`）
*   Token 效期約 10 天，過期後系統會自動用 `refresh_token` 換新

### **Rate Limit 行為**

[](https://github.com/sabgkang/openai_one/blob/master/OpenAI_one.md#rate-limit-%E8%A1%8C%E7%82%BA)

*   收到 `429` 回應時，該帳號會被暫時封鎖（預設 60 秒，或依 API 回傳的 `retry-after`）
*   封鎖期間自動切換到下一個帳號
*   重啟伺服器會清除所有記憶體中的 rate limit 狀態

### **WSL 使用者**

[](https://github.com/sabgkang/openai_one/blob/master/OpenAI_one.md#wsl-%E4%BD%BF%E7%94%A8%E8%80%85)

從 WSL 連接 Windows 上的 Gateway，需使用 Windows host IP：

HOST=$(ip route show default | awk '{print $3}')
curl http://$HOST:3000/v1/chat/completions ...

首次使用需在 Windows PowerShell（系統管理員）開放防火牆：

New-NetFirewallRule -DisplayName "Codex Gateway 3000" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow

### **ChatGPT 訂閱方案**

[](https://github.com/sabgkang/openai_one/blob/master/OpenAI_one.md#chatgpt-%E8%A8%82%E9%96%B1%E6%96%B9%E6%A1%88)

*   **免費版**：只可使用 `gpt5.4, gpt-5.4-mini, gpt-5.3-codex` ，有使用上限，可能有每日的上限，但看不出來，不過 OpenAI 的 Dashboard 可以看到每週的使用餘額。
*   本 Gateway **不消耗** OpenAI API Credits，使用的是 ChatGPT 訂閱額度