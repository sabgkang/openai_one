# AI Plan 彙整的 Gateway

## 緣起

使用 Hermes Agent 在嘗試很多不同的使用方法，所以使用類似 OpenAI Codex Plan (有 Free Plan)，比較划算。

但 Free Plan，但配額有限，常常試著試著，一個早上就把配額都用掉了。

不過用 GMail 帳號可以申請很多 OpenAI Codex Plan 帳號，所以想說做一個 AI Plan Gateway，模擬 OpenAI 的 API 介面接口。先輸入許多帳號，然後當一個帳號的 quota（配額）用完時，就切換到下一個帳號。

## 實作

將需求提供給 Claude Code 之後，它就寫出一個基本可運作的 gateway 程式。再花一些時間調整不同帳號的處理方式，以及增加 OpenAI API 對於 skills 跟 tools 的使用方式，程式基本能用。

不過有 Gateway 介於 Agent 和 OpenAI 之間，除了反應有些延遲外，對於可能未使用過的 OpenAI API 使用方式，也是要遇到才會發現問題，然後再加上去。

而且之前 Hermes 用 setup 的方式來切換帳號比較繁雜，後來發現可以使用拷貝 auth.json 檔的方式來做快速切換帳號。切換帳號也不過就是一個拷貝指令執行的時間，在發現帳號已經用到配額上限的時候進行切換，可能比每次對話都要有一些時間延遲來得好。

但這次實作也學到了不少東西，也許以後在某些應用場合，還可以讓它派上用場。

---

## 快速開始

```bash
npm install
npm run import-account -- <帳號名稱> <auth檔案路徑>
npm start
```

預設監聽 `http://localhost:3000`，將 OpenAI SDK 或 Agent 的 `base_url` 指向 `http://localhost:3000/v1` 即可。

詳細說明請參考 [OpenAI_one.md](./OpenAI_one.md)。

---

## 帳號管理

| 指令 | 說明 |
|------|------|
| `npm run import-account -- <名稱> <路徑>` | 從 auth.json 匯入帳號 |
| `npm run remove-account -- <名稱>` | 移除帳號 |
| `npm start -- --list` | 列出所有帳號狀態 |
| `npm start -- --account <名稱>` | 強制使用指定帳號 |

所有指令均支援 `--help`。

---

## 帳號切換策略

所有請求集中送到同一個帳號（concurrent 請求自動排隊）。當該帳號收到 `429 rate limited` 回應時，自動切換到下一個可用帳號，等待中的請求也一併轉過去。

---

## 專案結構

```
src/
  open_ai_server.js   Express 伺服器，處理 /v1/chat/completions
  codexClient.js      Chat Completions ↔ Responses API 格式轉換與請求
  accountManager.js   帳號輪替、rate limit 追蹤、請求排隊
  tokenManager.js     Token 讀寫、自動刷新

scripts/
  add-account.js               OAuth Device Flow 新增帳號
  import-from-codex-cli.js     從 auth.json 匯入帳號
  remove-account.js            移除帳號

data/
  accounts.json       帳號與 token 儲存（已加入 .gitignore）
```

---

## 已知限制

- **單一連線**：每個帳號同時只處理一個請求，並行請求會排隊。帳號越多，整體吞吐量越高。
- **Responses API 限制**：底層使用 `chatgpt.com/backend-api/codex/responses`，僅支援 `gpt-5.4-mini`、`gpt-5.4`、`codex-mini-latest` 等 Codex 模型。
- **Token 效期**：access token 約 10 天有效，過期後自動用 refresh token 換新；若 refresh token 也失效，需重新匯入 auth.json。
- **無身份驗證**：Gateway 本身不驗證 API Key，不建議對外開放。
