import { readdir, readFile, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
for (const directory of ['js', 'config', 'backend', 'scripts']) {
  for (const file of await readdir(resolve(root, directory))) {
    if (!/\.(?:js|mjs)$/.test(file)) continue;
    const result = spawnSync(process.execPath, ['--check', resolve(root, directory, file)], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr);
  }
}
for (const file of ['package.json', 'firebase.json', 'firestore.indexes.json', 'manifest.webmanifest', '.prettierrc', '.firebaserc', '.vscode/settings.json', '.vscode/extensions.json']) JSON.parse(await readFile(resolve(root, file), 'utf8'));
const sw = await readFile(resolve(root, 'service-worker.js'), 'utf8');
const essential = sw.slice(sw.indexOf('const ESSENTIAL'), sw.indexOf('self.addEventListener'));
for (const match of essential.matchAll(/'\.\/([^']*)'/g)) {
  if (match[1]) await access(resolve(root, match[1]));
}
console.log('Sintaxe, configurações JSON e recursos do cache verificados.');
