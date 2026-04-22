const { loadAccounts, saveAccounts, getValidToken } = require('./tokenManager');

const rateLimitedUntil = new Map();
const busyAccounts = new Set();   // 目前正在處理請求的帳號 id
const waitQueue = [];              // 等待可用帳號的 Promise resolve
let pinnedAccountName = null;     // --account <name> 設定的強制帳號

function setPinnedAccount(name) {
  pinnedAccountName = name;
}

function releaseAccount(accountId) {
  busyAccounts.delete(accountId);
  if (waitQueue.length > 0) waitQueue.shift()();
}

function isRateLimited(accountId) {
  const until = rateLimitedUntil.get(accountId);
  return until && Date.now() < until;
}

function markRateLimited(accountId, retryAfterSeconds) {
  const seconds = retryAfterSeconds || parseInt(process.env.DEFAULT_RATE_LIMIT_SECONDS || '60');
  rateLimitedUntil.set(accountId, Date.now() + seconds * 1000);
  const name = loadAccounts().find(a => a.id === accountId)?.name || accountId;
  console.log(`[AccountManager] 帳號 "${name}" rate limited，${seconds}s 後解除`);
}

async function getNextAccount() {
  while (true) {
    const accounts = loadAccounts();
    if (accounts.length === 0) {
      throw new Error('尚未設定任何帳號，請先執行 npm run add-account');
    }

    // --account 模式：強制使用指定帳號，busy 時等待
    if (pinnedAccountName) {
      const pinned = accounts.find(a => a.name === pinnedAccountName);
      if (!pinned) throw new Error(`找不到帳號 "${pinnedAccountName}"`);
      if (isRateLimited(pinned.id)) {
        const until = rateLimitedUntil.get(pinned.id);
        const waitSec = Math.ceil((until - Date.now()) / 1000);
        throw new Error(`帳號 "${pinnedAccountName}" rate limited，${waitSec}s 後恢復`);
      }
      if (!busyAccounts.has(pinned.id)) {
        busyAccounts.add(pinned.id);
        const all = loadAccounts();
        const idx = all.findIndex(a => a.id === pinned.id);
        all[idx].lastUsed = Date.now();
        saveAccounts(all);
        const token = await getValidToken(pinned.id);
        console.log(`[AccountManager] 使用帳號(pinned): "${pinned.name}"`);
        return { account: pinned, token };
      }
      // pinned 帳號忙碌中，等待釋放
      await new Promise(resolve => waitQueue.push(resolve));
      continue;
    }

    // round-robin：從未 rate limited 且未忙碌的帳號中選最久未使用的
    const available = accounts.filter(a => !isRateLimited(a.id) && !busyAccounts.has(a.id));

    if (available.length > 0) {
      available.sort((a, b) => (a.lastUsed || 0) - (b.lastUsed || 0));
      const chosen = available[0];
      busyAccounts.add(chosen.id);
      const all = loadAccounts();
      const idx = all.findIndex(a => a.id === chosen.id);
      all[idx].lastUsed = Date.now();
      saveAccounts(all);
      const token = await getValidToken(chosen.id);
      console.log(`[AccountManager] 使用帳號: "${chosen.name}"`);
      return { account: chosen, token };
    }

    // 所有未 rate limited 的帳號都忙碌中，等待釋放
    const notRateLimited = accounts.filter(a => !isRateLimited(a.id));
    if (notRateLimited.length === 0) {
      const nextUnlock = Math.min(...accounts.map(a => rateLimitedUntil.get(a.id) || Infinity));
      const waitSec = Math.ceil((nextUnlock - Date.now()) / 1000);
      throw new Error(`所有帳號都在 rate limit 中，最快 ${waitSec}s 後恢復`);
    }

    await new Promise(resolve => waitQueue.push(resolve));
  }
}

function listAccounts() {
  return loadAccounts().map(a => ({
    id: a.id,
    name: a.name,
    pinned: a.name === pinnedAccountName,
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

module.exports = { getNextAccount, releaseAccount, markRateLimited, listAccounts, clearRateLimits, setPinnedAccount };
