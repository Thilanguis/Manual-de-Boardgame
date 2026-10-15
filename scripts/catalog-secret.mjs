// Lê um arquivo privado local e envia o token via stdin; nada vai ao frontend.
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve, dirname, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const [source, file] = process.argv.slice(2),
  secrets = { ludopedia: 'LUDOPEDIA_TOKEN', bgg: 'BGG_TOKEN' };
if (!secrets[source] || !file) {
  console.error('Uso: node scripts/catalog-secret.mjs ludopedia|bgg CAMINHO_DO_JSON_PRIVADO');
  process.exit(1);
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  path = resolve(file),
  rel = relative(root, path);
if (rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel)) throw new Error('Guarde o JSON privado fora da pasta do projeto.');
let data;
try {
  data = JSON.parse(await readFile(path, 'utf8'));
} catch {
  console.error('Não foi possível ler o JSON privado. Confira o caminho e o formato, sem colar seu conteúdo no chat.');
  process.exit(1);
}
const token = data.access_token || data.token;
if (typeof token !== 'string' || token.length < 12 || token.length > 4096 || /[\r\n\x00]/.test(token)) throw new Error('Token ausente ou inválido. O JSON deve conter access_token ou token.');
const args = [resolve(root, 'worker/node_modules/wrangler/bin/wrangler.js'), 'secret', 'put', secrets[source], '--config', resolve(root, 'worker/wrangler.jsonc')];
const child = spawn(process.execPath, args, { cwd: root, stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true });
child.stdin.on('error', () => {});
child.stdin.end(token + '\n');
child.on('error', () => {
  console.error('Não foi possível iniciar o Wrangler. Instale as dependências e confira o login Cloudflare.');
  process.exitCode = 1;
});
child.on('exit', (code) => {
  if (code === 0) console.log(`${secrets[source]} configurado no Worker. Nenhum token foi publicado no site.`);
  else {
    console.error('O Worker não confirmou a configuração. Confira o login e as permissões Cloudflare.');
    process.exitCode = 1;
  }
});
