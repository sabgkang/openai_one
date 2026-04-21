/**
 * 互動式新增 Codex 帳號
 * 使用方式: node scripts/add-account.js [帳號名稱]
 */

require('dotenv').config();
const axios = require('axios');
const crypto = require('crypto');
const { loadAccounts, saveAccounts } = require('../src/tokenManager');

const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const DEVICE_CODE_ENDPOINT = 'https://auth.openai.com/oauth/device/code';
const TOKEN_ENDPOINT = 'https://auth.openai.com/oauth/token';

// 模擬官方 Codex CLI 的請求 headers，繞過 Cloudflare 篩選
const CLI_HEADERS = {
  'User-Agent': 'node-fetch/1.0 (+https://github.com/bitinn/node-fetch)',
  'Accept': 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
  'Content-Type': 'application/x-www-form-urlencoded',
};

// OAuth 標準格式：application/x-www-form-urlencoded
function toFormEncoded(obj) {
  return new URLSearchParams(obj).toString();
}

async function main() {
  const accountName = process.argv[2] || `account_${Date.now()}`;
  console.log(`\n新增帳號: "${accountName}"`);

  let deviceData;
  try {
    const res = await axios.post(
      DEVICE_CODE_ENDPOINT,
      toFormEncoded({
        client_id: CLIENT_ID,
        scope: 'openid profile email offline_access model.read model.request',
        audience: 'https://api.openai.com/v1',
      }),
      { headers: CLI_HEADERS }
    );
    deviceData = res.data;
  } catch (err) {
    const body = err.response?.data;
    // 若還是收到 HTML，顯示更清楚的提示
    if (typeof body === 'string' && body.includes('<!DOCTYPE')) {
      console.error('錯誤：auth.openai.com 拒絕了連線（Cloudflare 封鎖）');
      console.error('請確認：1) 網路可以存取 auth.openai.com  2) 沒有 proxy 干擾');
    } else {
      console.error('無法取得裝置授權碼:', body || err.message);
    }
    process.exit(1);
  }

  const { device_code, user_code, verification_uri_complete, interval = 5, expires_in = 300 } = deviceData;

  console.log(`\n請在瀏覽器開啟以下網址完成授權：`);
  console.log(`  ${verification_uri_complete}`);
  console.log(`\n或手動輸入驗證碼: ${user_code}`);
  console.log(`\n等待授權（${expires_in}s 內有效）...\n`);

  try {
    const tokenData = await pollForToken(device_code, interval, expires_in);

    const accounts = loadAccounts();
    accounts.push({
      id: crypto.randomUUID(),
      name: accountName,
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token || null,
      expires_at: Date.now() + (tokenData.expires_in || 3600) * 1000,
      lastUsed: 0,
      createdAt: new Date().toISOString(),
    });
    saveAccounts(accounts);

    console.log(`\n✅ 帳號 "${accountName}" 授權成功`);
    console.log(`目前共有 ${accounts.length} 個帳號：`);
    accounts.forEach((a, i) => console.log(`  ${i + 1}. ${a.name} (${a.id})`));
  } catch (err) {
    console.error('\n授權失敗:', err.message);
    process.exit(1);
  }
}

function pollForToken(deviceCode, intervalSeconds, expiresIn) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + expiresIn * 1000;
    let currentInterval = intervalSeconds;

    const fire = async () => {
      if (Date.now() > deadline) {
        return reject(new Error('授權碼已過期，請重新執行'));
      }

      try {
        const res = await axios.post(
          TOKEN_ENDPOINT,
          toFormEncoded({
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
            device_code: deviceCode,
            client_id: CLIENT_ID,
          }),
          { headers: CLI_HEADERS }
        );

        if (res.data.access_token) {
          resolve(res.data);
          return;
        }
      } catch (err) {
        const error = err.response?.data?.error;
        if (error === 'authorization_pending') {
          process.stdout.write('.');
        } else if (error === 'slow_down') {
          currentInterval += 5; // 依 RFC 8628 規定增加間隔
        } else {
          return reject(new Error(error || err.message));
        }
      }

      setTimeout(fire, currentInterval * 1000);
    };

    setTimeout(fire, currentInterval * 1000);
  });
}

main();
