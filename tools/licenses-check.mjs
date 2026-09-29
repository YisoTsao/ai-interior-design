#!/usr/bin/env node
// 依賴授權掃描（B10 CI 閘門、docs/licenses.md）：production 依賴只允許寬鬆授權；copyleft / 未知 → 失敗。
import { execFileSync } from 'node:child_process';

const ALLOW = new Set(['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '0BSD', 'BSL-1.0', 'CC0-1.0', 'Unlicense', 'Python-2.0', 'BlueOak-1.0.0', 'CC-BY-4.0', 'Zlib']);
// 需人工確認後才可加入（例如 MPL 檔案級 copyleft）
const REVIEW = new Set(['MPL-2.0']);

const raw = execFileSync('pnpm', ['licenses', 'list', '--prod', '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const byLicense = JSON.parse(raw);
const bad = [];
const review = [];
let count = 0;
for (const [license, pkgs] of Object.entries(byLicense)) {
  for (const p of pkgs) {
    count++;
    const ids = license.replace(/[()]/g, '').split(/\s+OR\s+/i);
    if (ids.some((l) => ALLOW.has(l.trim()))) continue;
    (ids.some((l) => REVIEW.has(l.trim())) ? review : bad).push(`${p.name}@${(p.versions ?? [p.version]).join(',')} (${license})`);
  }
}
for (const r of review) console.log(`! 需確認：${r}`);
for (const b of bad) console.log(`✗ 不允許：${b}`);
console.log(`${bad.length ? '✗' : '✓'} production 依賴 ${count} 個；不允許 ${bad.length}、需確認 ${review.length}`);
process.exit(bad.length ? 1 : 0);
