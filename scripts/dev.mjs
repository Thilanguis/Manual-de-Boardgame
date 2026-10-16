import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, access, rm } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertDevelopment, PROJECT, OWNER, DIRECTORY } from './dev-config.mjs';
import { seed } from './dev-seed.mjs';
import { primeKnowledge } from './dev-prime.mjs';
process.chdir(fileURLToPath(new URL('..', import.meta.url)));
assertDevelopment();
const command = process.argv[2] || 'start';
const control = 'http://127.0.0.1:4181';
if (['stop', 'reset'].includes(command)) {
  const response = await fetch(`${control}/${command}`, { method: 'POST' }).catch(() => null);
  if (!response?.ok) throw new Error(response ? await response.text() : 'Ambiente local não está iniciado. Use npm run dev.');
  console.log(await response.text());
  process.exit(0);
}
if (command === 'open') {
  spawn('powershell', ['-NoProfile', '-Command', "Start-Process 'http://localhost:4173'"], { stdio: 'ignore', windowsHide: true }).unref();
  process.exit(0);
}
if (command !== 'start') throw new Error('Comando desconhecido.');
await mkdir(DIRECTORY, { recursive: true });
const portable = resolve('.test-tools/jdk-21.0.12.1+1-jre');
try {
  await access(resolve(portable, 'bin/java.exe'));
  process.env.JAVA_HOME = portable;
  process.env.PATH = `${portable}/bin;${process.env.PATH}`;
} catch {}
process.env.WRANGLER_LOG_PATH = resolve(DIRECTORY, 'wrangler.log');
process.env.WRANGLER_SEND_METRICS = 'false';
process.env.ACERVO_DEVELOPMENT = '1';
process.env.FIREBASE_CLI_DISABLE_USAGE_REPORTING = 'true';
const children = new Set();
function start(script, args = []) {
  const child = spawn(process.execPath, [script, ...args], { stdio: 'inherit', env: process.env, windowsHide: true });
  children.add(child);
  child.once('exit', () => children.delete(child));
  return child;
}
async function until(url, timeout = 60000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      await fetch(url, { signal: AbortSignal.timeout(1000) });
      return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Serviço local não iniciou: ${url}`);
}
let stopping = false,
  worker,
  server;
async function exportData() {
  // Exportação direta: evita a troca de diretórios por rename do CLI no Windows.
  const target = resolve(DIRECTORY, 'firebase-export');
  if (relative(DIRECTORY, target) !== 'firebase-export') throw new Error('Destino de exportação inválido.');
  await mkdir(resolve(target, 'auth_export'), { recursive: true });
  const response = await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}:export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ database: `projects/${PROJECT}/databases/(default)`, export_directory: target, export_name: 'firestore_export' }),
  });
  if (!response.ok) throw new Error(`Exportação local: ${response.status}`);
  for (const [name, path] of [
    ['accounts.json', `identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:batchGet?maxResults=-1`],
    ['config.json', `emulator/v1/projects/${PROJECT}/config`],
  ]) {
    const result = await fetch(`http://127.0.0.1:9099/${path}`, { headers: { Authorization: 'Bearer owner' } });
    if (!result.ok) throw new Error('Não foi possível exportar as contas fictícias.');
    await writeFile(resolve(target, 'auth_export', name), await result.text());
  }
  await writeFile(
    resolve(target, 'firebase-export-metadata.json'),
    JSON.stringify({ version: '15.33.0', firestore: { version: '1', path: 'firestore_export', metadata_file: 'firestore_export/firestore_export.overall_export_metadata' }, auth: { version: '1', path: 'auth_export' } }),
  );
}
async function stopWorker() {
  if (!worker || worker.exitCode !== null) return;
  const ended = new Promise((r) => worker.once('exit', r));
  await fetch('http://127.0.0.1:8788/stop', { method: 'POST' }).catch(() => worker.kill());
  await ended;
}
async function stop() {
  if (stopping) return;
  stopping = true;
  try {
    await stopWorker();
    await exportData();
  } catch (error) {
    console.error(error.message);
  }
  server?.closeAllConnections();
  server?.close();
  // Os filhos conhecidos pertencem exclusivamente a este comando.
  for (const child of children) {
    if (process.platform === 'win32') spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(0), 500);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
try {
  for (const port of [4173, 4181, 8080, 9099, 8787, 8788, 4400]) {
    const net = await import('node:net');
    await new Promise((yes, no) => {
      const socket = net.createServer();
      socket.once('error', () => no(new Error(`A porta ${port} está ocupada. Encerre o serviço anterior.`)));
      socket.listen(port, '127.0.0.1', () => socket.close(yes));
    });
  }
  const rules = (await readFile('firestore.rules', 'utf8')).replaceAll('7TitBObtb8a0W8GisSstSM1RHiX2', OWNER);
  await writeFile(resolve(DIRECTORY, 'firestore.rules'), rules);
  await writeFile(
    resolve(DIRECTORY, 'firebase.json'),
    JSON.stringify({
      firestore: { rules: resolve(DIRECTORY, 'firestore.rules'), indexes: resolve('firestore.indexes.json') },
      emulators: { auth: { host: '127.0.0.1', port: 9099 }, firestore: { host: '127.0.0.1', port: 8080 }, hub: { host: '127.0.0.1', port: 4400 }, logging: { host: '127.0.0.1', port: 4500 }, ui: { enabled: false }, singleProjectMode: true },
    }),
  );
  const build = start('worker/node_modules/wrangler/bin/wrangler.js', ['deploy', '--dry-run', '--outdir', '.build', '--config', 'worker/wrangler.dev.jsonc']);
  const code = await new Promise((r) => build.once('exit', r));
  if (code !== 0) throw new Error('Falha no build local do Worker.');
  const args = ['emulators:start', '--project', PROJECT, '--only', 'auth,firestore', '--config', resolve(DIRECTORY, 'firebase.json')];
  try {
    await access(resolve(DIRECTORY, 'firebase-export/firebase-export-metadata.json'));
    args.push('--import', resolve(DIRECTORY, 'firebase-export'));
  } catch {}
  start('node_modules/firebase-tools/lib/bin/firebase.js', args);
  await Promise.all([until('http://127.0.0.1:8080'), until('http://127.0.0.1:9099')]);
  await seed();
  worker = start('scripts/dev-worker.mjs');
  await until('http://127.0.0.1:8787/health');
  await primeKnowledge();
  start('scripts/serve.mjs');
  await until('http://127.0.0.1:4173');
  server = createServer(async (req, res) => {
    if (req.headers.origin || !['127.0.0.1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) || req.method !== 'POST') {
      res.writeHead(403);
      res.end();
      return;
    }
    try {
      if (req.url === '/stop') {
        res.end('Encerrando os serviços locais e salvando os dados fictícios.');
        void stop();
      } else if (req.url === '/restart-worker') {
        await stopWorker();
        worker = start('scripts/dev-worker.mjs');
        await until('http://127.0.0.1:8787/health');
        await primeKnowledge();
        res.end('Worker local reiniciado.');
      } else if (req.url === '/reset') {
        await stopWorker();
        for (const name of ['sqlite', 'files']) {
          const target = resolve(DIRECTORY, name);
          if (relative(DIRECTORY, target) !== name) throw new Error('Destino inválido.');
          await rm(target, { recursive: true, force: true });
        }
        await seed({ reset: true });
        await exportData();
        worker = start('scripts/dev-worker.mjs');
        await until('http://127.0.0.1:8787/health');
        await primeKnowledge();
        res.end('Dados fictícios restaurados. Saia da conta e recarregue a página.');
      } else {
        res.writeHead(404);
        res.end();
      }
    } catch (error) {
      res.writeHead(500);
      res.end(error.message);
    }
  });
  await new Promise((r) => server.listen(4181, '127.0.0.1', r));
  console.log('\nAcervo isolado: http://localhost:4173\nConta: proprietario@acervo.test / Acervo-teste-123\nMétricas: http://127.0.0.1:8788/metrics\nEncerrar: npm run dev:stop (ou Ctrl+C).');
} catch (error) {
  console.error(error);
  await stop();
}
