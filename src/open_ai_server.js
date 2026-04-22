require('dotenv').config();
const express = require('express');
const { callCodex } = require('./codexClient');
const { getNextAccount, markRateLimited, listAccounts, clearRateLimits, setPinnedAccount } = require('./accountManager');

// ── CLI 選項處理 ─────────────────────────────────────────────
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
用法: npm start [-- <選項>]
      node src/open_ai_server.js [<選項>]

選項:
  --list               列出所有已設定帳號及狀態
  --account <名稱>     強制使用指定帳號（不輪替）
  --help, -h           顯示此說明

環境變數 (.env):
  PORT                        監聽 port（預設 3000）
  MAX_RETRIES                 單次請求最多嘗試帳號數（預設 3）
  DEFAULT_RATE_LIMIT_SECONDS  帳號 rate limit 封鎖秒數（預設 60）

範例:
  npm start
  npm start -- --list
  npm start -- --account HDD7
`);
  process.exit(0);
}

if (args.includes('--list')) {
  const accounts = listAccounts();
  if (accounts.length === 0) {
    console.log('尚未設定任何帳號。執行 npm run import-account 來新增。');
  } else {
    console.log(`\n共有 ${accounts.length} 個帳號：\n`);
    accounts.forEach((a, i) => {
      const pin    = a.pinned      ? ' [pinned]'      : '';
      const rl     = a.rateLimited ? ' [rate limited]' : '';
      const used   = a.lastUsed    ? `last used ${new Date(a.lastUsed).toLocaleString()}` : 'never used';
      const expires = a.tokenExpiresAt ? `token expires ${new Date(a.tokenExpiresAt).toLocaleString()}` : '';
      console.log(`  ${i + 1}. ${a.name}${pin}${rl}`);
      console.log(`     ${used}  ${expires}`);
    });
    console.log();
  }
  process.exit(0);
}

const accountArg = args.indexOf('--account');
if (accountArg !== -1) {
  const name = args[accountArg + 1];
  if (!name) {
    console.error('用法: npm start -- --account <帳號名稱>');
    process.exit(1);
  }
  const { loadAccounts } = require('./tokenManager');
  const exists = loadAccounts().find(a => a.name === name);
  if (!exists) {
    const all = loadAccounts().map(a => `  - ${a.name}`).join('\n');
    console.error(`錯誤：找不到帳號 "${name}"`);
    console.error(all.length ? `現有帳號：\n${all}` : '尚未設定任何帳號');
    process.exit(1);
  }
  setPinnedAccount(name);
  console.log(`[Config] 強制使用帳號: "${name}"`);
}
// ─────────────────────────────────────────────────────────────

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '3');

app.use(express.json({ limit: '10mb' }));

// body-parser 錯誤轉 JSON
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { message: 'Invalid JSON body', type: 'invalid_request_error' } });
  }
  next(err);
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', accounts: listAccounts() });
});

app.post('/debug/clear-rate-limits', (req, res) => {
  clearRateLimits();
  res.json({ ok: true, accounts: listAccounts() });
});

// 代理 /v1/chat/completions
app.post('/v1/chat/completions', async (req, res) => {
  let lastError = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    let account = null;
    try {
      const { account: acc, token } = await getNextAccount();
      account = acc;

      const result = await callCodex(token, req.body, res);

      if (result === null) return; // streaming 已直接 pipe

      if (result.status === 429) {
        const retryAfter = result.data?.error?.resets_at
          ? Math.ceil((result.data.error.resets_at * 1000 - Date.now()) / 1000)
          : null;
        markRateLimited(account.id, retryAfter);
        lastError = result;
        continue;
      }

      return res.status(result.status).json(result.data);

    } catch (err) {
      lastError = err;
      break;
    }
  }

  const status = lastError?.status || 500;
  const data = lastError?.data || { error: { message: lastError?.message || 'Gateway 內部錯誤', type: 'gateway_error' } };
  res.status(status).json(data);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Codex Gateway 啟動於 http://localhost:${PORT}`);
});
