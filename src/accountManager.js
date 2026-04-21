const { loadAccounts, saveAccounts, getValidToken } = require('./tokenManager');

// 記憶體內 rate limit 狀態（重啟後清除）
const rateLimitedUntil = new Map();

function isRateLimited(accountId) {
  const until = rateLimitedUntil.get(accountId);
  return until && Date.now() < until;
}

function markRateLimited(accountId, retryAfterSeconds) {
  const seconds = retryAfterSeconds || parseInt(process.env.DEFAULT_RATE_LIMIT_SECONDS || '60');
  const until = Date.now() + seconds * 1000;
  rateLimitedUntil.set(accountId, until);
  const name = loadAccounts().find(a => a.id === accountId)?.name || accountId;
  console.log(`[AccountManager] 帳號 "${name}" rate limited，${seconds}s 後解除`);
}

// 取得下一個可用帳號（round-robin，跳過 rate limited）
async function getNextAccount() {
  const accounts = loadAccounts();
  if (accounts.length === 0) {
    throw new Error('尚未設定任何帳號，請先執行 npm run add-account');
  }

  const available = accounts.filter(a => !isRateLimited(a.id));
  if (available.length === 0) {
    const nextUnlock = Math.min(...[...rateLimitedUntil.values()]);
    const waitSec = Math.ceil((nextUnlock - Date.now()) / 1000);
    throw new Error(`所有帳號都在 rate limit 中，最快 ${waitSec}s 後恢復`);
  }

  // 選最久沒被使用的帳號（round-robin）
  available.sort((a, b) => (a.lastUsed || 0) - (b.lastUsed || 0));
  const chosen = available[0];

  // 更新 lastUsed
  const all = loadAccounts();
  const idx = all.findIndex(a => a.id === chosen.id);
  all[idx].lastUsed = Date.now();
  saveAccounts(all);

  const token = await getValidToken(chosen.id);
  console.log(`[AccountManager] 使用帳號: "${chosen.name}"`);
  return { account: chosen, token };
}

// 列出所有帳號狀態
function listAccounts() {
  return loadAccounts().map(a => ({
    id: a.id,
    name: a.name,
    rateLimited: isRateLimited(a.id),
    rateLimitedUntil: rateLimitedUntil.get(a.id) || null,
    tokenExpiresAt: a.expires_at ? new Date(a.expires_at).toISOString() : null,
    lastUsed: a.lastUsed ? new Date(a.lastUsed).toISOString() : null,
    createdAt: a.createdAt,
  }));
}

function clearRateLimits() {
  rateLimitedUntil.clear();
  console.log('[AccountManager] 已清除所有 rate limit 狀態');
}

module.exports = { getNextAccount, markRateLimited, listAccounts, clearRateLimits };
