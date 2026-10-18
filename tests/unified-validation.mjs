import '../scripts/test-guard.mjs';
import { spawn } from 'node:child_process';
for (const args of [
  ['tests/unified-rules-firestore-browser.mjs'],
  ['--import', './scripts/test-guard.mjs', '--test', 'security/*.test.mjs'],
]) {
  const child = spawn(process.execPath, args, { stdio: 'inherit', env: process.env, windowsHide: true });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  if (code !== 0) process.exit(code || 1);
}
