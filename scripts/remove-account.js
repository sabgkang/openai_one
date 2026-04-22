const { loadAccounts, saveAccounts } = require('../src/tokenManager');

const name = process.argv[2];

if (!name || name === '--help' || name === '-h') {
  console.log(`
用法: npm run remove-account -- <帳號名稱>
      npm run remove-account -- --list

選項:
  --list         列出所有已設定帳號
  --help, -h     顯示此說明

範例:
  npm run remove-account -- HDD7
  npm run remove-account -- --list
`);
  process.exit(name ? 0 : 1);
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
