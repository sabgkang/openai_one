const { loadAccounts, saveAccounts } = require('../src/tokenManager');

const name = process.argv[2];

if (!name) {
  console.error('用法: npm run remove-account -- <帳號名稱>');
  console.error('      npm run remove-account -- --list  (列出所有帳號)');
  process.exit(1);
}

const accounts = loadAccounts();

if (name === '--list') {
  if (accounts.length === 0) {
    console.log('尚未設定任何帳號。');
  } else {
    accounts.forEach((a, i) => console.log(`  ${i + 1}. ${a.name}`));
  }
  process.exit(0);
}

const idx = accounts.findIndex(a => a.name === name);
if (idx === -1) {
  const names = accounts.map(a => `  - ${a.name}`).join('\n');
  console.error(`錯誤：找不到帳號 "${name}"`);
  if (names) console.error(`現有帳號：\n${names}`);
  process.exit(1);
}

accounts.splice(idx, 1);
saveAccounts(accounts);

console.log(`✅ 帳號 "${name}" 已移除，剩餘 ${accounts.length} 個帳號。`);
