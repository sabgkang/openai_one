require('dotenv').config();
const express = require('express');
const { callCodex } = require('./codexClient');
const { getNextAccount, releaseAccount, markRateLimited, listAccounts, clearRateLimits, setPinnedAccount } = require('./accountManager');

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
const LOG_PASSWORD = process.env.LOG_PASSWORD || '';

// ── Log 攔截 ─────────────────────────────────────────────────
const LOG_BUFFER_SIZE = 500;
const logBuffer = [];        // { ts, level, msg }
const logClients = new Set(); // SSE 連線

function pushLog(level, args) {
  const msg = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  const entry = { ts: new Date().toISOString(), level, msg };
  logBuffer.push(entry);
  if (logBuffer.length > LOG_BUFFER_SIZE) logBuffer.shift();
  const line = `data: ${JSON.stringify(entry)}\n\n`;
  for (const client of logClients) client.write(line);
}

const _log   = console.log.bind(console);
const _error = console.error.bind(console);
console.log   = (...a) => { _log(...a);   pushLog('log',   a); };
console.error = (...a) => { _error(...a); pushLog('error', a); };
// ─────────────────────────────────────────────────────────────

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

// ── Log 頁面 ─────────────────────────────────────────────────
function checkLogAuth(req, res) {
  if (!LOG_PASSWORD) return true;
  const auth = req.headers.authorization || '';
  const b64 = auth.startsWith('Basic ') ? Buffer.from(auth.slice(6), 'base64').toString() : '';
  if (b64 === `:${LOG_PASSWORD}`) return true;
  res.set('WWW-Authenticate', 'Basic realm="Gateway Logs"');
  res.status(401).send('Unauthorized');
  return false;
}

app.get('/logs', (req, res) => {
  if (!checkLogAuth(req, res)) return;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<title>Gateway Logs</title>
<style>
  body { background:#1e1e1e; color:#d4d4d4; font:13px/1.5 monospace; margin:0; padding:12px; }
  #log { white-space:pre-wrap; word-break:break-all; }
  .error { color:#f48771; }
  .ts { color:#888; }
  #status { position:fixed; top:8px; right:12px; font-size:11px; color:#888; }
  #clear { position:fixed; top:4px; left:12px; cursor:pointer; background:#333; border:1px solid #555; color:#ccc; padding:2px 8px; border-radius:3px; }
</style>
</head>
<body>
<button id="clear" onclick="document.getElementById('log').textContent=''">Clear</button>
<div id="status">connecting…</div>
<div id="log"></div>
<script>
const logEl = document.getElementById('log');
const status = document.getElementById('status');
let autoScroll = true;
window.addEventListener('scroll', () => {
  autoScroll = window.innerHeight + window.scrollY >= document.body.scrollHeight - 50;
});
const es = new EventSource('/logs/stream');
es.onopen = () => status.textContent = 'connected';
es.onerror = () => status.textContent = 'disconnected — retrying…';
es.onmessage = e => {
  const { ts, level, msg } = JSON.parse(e.data);
  const line = document.createElement('span');
  if (level === 'error') line.className = 'error';
  line.innerHTML = '<span class="ts">' + ts.replace('T',' ').slice(0,19) + '</span>  ' + msg.replace(/&/g,'&amp;').replace(/</g,'&lt;') + '\\n';
  logEl.appendChild(line);
  if (autoScroll) window.scrollTo(0, document.body.scrollHeight);
};
</script>
</body>
</html>`);
});

app.get('/logs/stream', (req, res) => {
  if (!checkLogAuth(req, res)) return;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // 先把 buffer 裡的歷史 log 送出去
  for (const entry of logBuffer) res.write(`data: ${JSON.stringify(entry)}\n\n`);

  logClients.add(res);
  req.on('close', () => logClients.delete(res));
});
// ─────────────────────────────────────────────────────────────

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
      releaseAccount(account.id);

      if (result === null) return; // streaming 已直接 pipe

      if (result.status === 429) {
        const retryAfter = result.data?.error?.resets_at
          ? Math.ceil((result.data.error.resets_at * 1000 - Date.now()) / 1000)
          : null;
        markRateLimited(account.id, retryAfter);
        lastError = result;
        account = null;
        continue;
      }

      return res.status(result.status).json(result.data);

    } catch (err) {
      if (account) releaseAccount(account.id);
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
