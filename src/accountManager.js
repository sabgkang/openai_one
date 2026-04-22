const { loadAccounts, saveAccounts, getValidToken } = require('./tokenManager');

const rateLimitedUntil = new Map();
const busyAccounts = new Set();   // 目前正在處理請求的帳號 id
const waitQueue = [];              // 等待可用帳號的 Promise resolve
let pinnedAccountName = null;     // --account <name> 設定的強制帳號
let activeAccountId = null;       // 目前使用的帳號，rate limited 才切下一個

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
  const accounts = loadAccounts();
  const name = accounts.find(a => a.id === accountId)?.name || accountId;
  console.log(`[AccountManager] 帳號 "${name}" rate limited，${seconds}s 後解除`);

  // 若目前使用的帳號被 rate limited，切換到下一個可用帳號
  if (activeAccountId === accountId) {
    const next = accounts.find(a => a.id !== accountId && !isRateLimited(a.id));
    activeAccountId = next?.id || null;
    if (next) console.log(`[AccountManager] 切換至帳號: "${next.name}"`);
    else console.log('[AccountManager] 所有帳號均 rate limited');
    // 喚醒等待中的請求，讓它們重新判斷
    while (waitQueue.length > 0) waitQueue.shift()();
  }
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

    // 初始化：選第一個未 rate limited 的帳號
    if (!activeAccountId || isRateLimited(activeAccountId)) {
      const first = accounts.find(a => !isRateLimited(a.id));
      if (!first) {
        const nextUnlock = Math.min(...accounts.map(a => rateLimitedUntil.get(a.id) || Infinity));
        const waitSec = Math.ceil((nextUnlock - Date.now()) / 1000);
        throw new Error(`所有帳號都在 rate limit 中，最快 ${waitSec}s 後恢復`);
      }
      activeAccountId = first.id;
    }

    const active = accounts.find(a => a.id === activeAccountId);

    // active 帳號忙碌時排隊等待
    if (busyAccounts.has(active.id)) {
      await new Promise(resolve => waitQueue.push(resolve));
      continue;
    }

    busyAccounts.add(active.id);
    const all = loadAccounts();
    const idx = all.findIndex(a => a.id === active.id);
    all[idx].lastUsed = Date.now();
    saveAccounts(all);
    const token = await getValidToken(active.id);
    console.log(`[AccountManager] 使用帳號: "${active.name}"`);
    return { account: active, token };
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
