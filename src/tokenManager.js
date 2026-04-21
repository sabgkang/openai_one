const axios = require('axios');
const fs = require('fs');
const path = require('path');

const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const TOKEN_ENDPOINT = 'https://auth.openai.com/oauth/token';
const DATA_FILE = path.join(__dirname, '../data/accounts.json');

function loadAccounts() {
  if (!fs.existsSync(DATA_FILE)) return [];
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function saveAccounts(accounts) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(accounts, null, 2), { mode: 0o600 });
}

async function refreshAccessToken(account) {
  const res = await axios.post(TOKEN_ENDPOINT, {
    grant_type: 'refresh_token',
    refresh_token: account.refresh_token,
    client_id: CLIENT_ID,
  });

  account.access_token = res.data.access_token;
  // refresh_token rotation: 若有新的就更新，否則沿用舊的
  account.refresh_token = res.data.refresh_token || account.refresh_token;
  account.expires_at = Date.now() + (res.data.expires_in || 3600) * 1000;
  return account;
}

// 取得有效 token，若快到期則自動刷新
async function getValidToken(accountId) {
  const accounts = loadAccounts();
  const idx = accounts.findIndex(a => a.id === accountId);
  if (idx === -1) throw new Error(`找不到帳號: ${accountId}`);

  const account = accounts[idx];
  const needsRefresh = account.expires_at && Date.now() > account.expires_at - 5 * 60 * 1000;

  if (needsRefresh && account.refresh_token) {
    try {
      accounts[idx] = await refreshAccessToken(accounts[idx]);
      saveAccounts(accounts);
      console.log(`[TokenManager] 帳號 "${accounts[idx].name}" token 已刷新`);
      return accounts[idx].access_token;
    } catch (err) {
      console.error(`[TokenManager] 帳號 "${account.name}" 刷新失敗:`, err.response?.data || err.message);
      // 刷新失敗，先試用舊 token（可能還沒過期）
    }
  }

  return account.access_token;
}

module.exports = { loadAccounts, saveAccounts, refreshAccessToken, getValidToken };
