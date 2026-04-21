/**
 * 從 auth 檔案匯入帳號 token
 *
 * 支援格式：
 *   - 官方 Codex CLI:  { access_token, refresh_token }
 *   - OpenCode 格式:   { version, providers: { "openai-codex": { tokens: { access_token, refresh_token } } } }
 *
 * 使用方式：
 *   node scripts/import-from-codex-cli.js [帳號名稱] [auth檔案路徑]
 *
 * 範例：
 *   node scripts/import-from-codex-cli.js "hdd7"
 *   node scripts/import-from-codex-cli.js "hdd7" ./hdd0_auth.json
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { loadAccounts, saveAccounts } = require('../src/tokenManager');

const DEFAULT_AUTH_PATHS = [
  path.join(os.homedir(), '.codex', 'auth.json'),
  path.join(process.env.APPDATA || '', 'openai', 'codex', 'auth.json'),
  path.join(os.homedir(), '.config', 'openai', 'codex', 'auth.json'),
];

function extractTokens(raw) {
  // OpenCode 格式
  if (raw.version && raw.providers?.['openai-codex']?.tokens) {
    const t = raw.providers['openai-codex'].tokens;
    const lastRefresh = raw.providers['openai-codex'].last_refresh;
    return {
      access_token:  t.access_token,
      refresh_token: t.refresh_token || null,
      // access token 有效期通常 10 天，從 last_refresh 計算
      expires_at: lastRefresh
        ? new Date(lastRefresh).getTime() + 10 * 24 * 60 * 60 * 1000
        : Date.now() + 3600 * 1000,
    };
  }

  // 官方 Codex CLI 格式
  if (raw.access_token || raw.accessToken) {
    const expires_in = raw.expires_in || raw.expiresIn || 3600;
    return {
      access_token:  raw.access_token  || raw.accessToken,
      refresh_token: raw.refresh_token || raw.refreshToken || null,
      expires_at: raw.expires_at || raw.expiresAt
        ? new Date(raw.expires_at || raw.expiresAt).getTime()
        : Date.now() + expires_in * 1000,
    };
  }

  return null;
}

function main() {
  const accountName = process.argv[2] || `imported_${Date.now()}`;
  const customPath  = process.argv[3] || null;

  let authFile = customPath
    ? path.resolve(customPath)
    : DEFAULT_AUTH_PATHS.find(p => fs.existsSync(p));

  if (!authFile || !fs.existsSync(authFile)) {
    console.error('找不到 auth 檔案');
    if (customPath) {
      console.error(`指定路徑不存在：${customPath}`);
    } else {
      console.error('請指定檔案路徑，或搜尋以下位置：');
      DEFAULT_AUTH_PATHS.forEach(p => console.error('  ' + p));
    }
    process.exit(1);
  }

  console.log(`讀取：${authFile}`);
  const raw = JSON.parse(fs.readFileSync(authFile, 'utf8'));
  const tokens = extractTokens(raw);

  if (!tokens) {
    console.error('無法識別 auth 檔案格式，內容：');
    console.error(JSON.stringify(raw, null, 2));
    process.exit(1);
  }

  const accounts = loadAccounts();
  const duplicate = accounts.find(a => a.access_token === tokens.access_token);
  if (duplicate) {
    console.log(`⚠️  此 token 已存在（帳號："${duplicate.name}"），略過`);
    process.exit(0);
  }

  accounts.push({
    id: crypto.randomUUID(),
    name: accountName,
    ...tokens,
    lastUsed: 0,
    createdAt: new Date().toISOString(),
  });
  saveAccounts(accounts);

  console.log(`✅ 帳號 "${accountName}" 匯入成功`);
  console.log(`目前共有 ${accounts.length} 個帳號`);
}

main();
