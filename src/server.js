require('dotenv').config();
const express = require('express');
const { callCodex } = require('./codexClient');
const { getNextAccount, markRateLimited, listAccounts, clearRateLimits } = require('./accountManager');

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
