import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = resolve(root, 'public');
if (relative(root, target) !== 'public' || !target.startsWith(root + sep)) throw new Error('Destino de build inválido.');
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
for (const path of ['index.html', 'styles', 'js', 'assets', 'vendor', 'manifest.webmanifest', 'service-worker.js']) await cp(resolve(root, path), resolve(target, path), { recursive: true });
await mkdir(resolve(target, 'config'));
await cp(resolve(root, 'config/app-config.js'), resolve(target, 'config/app-config.js'));
const config = await readFile(resolve(target, 'config/app-config.js'), 'utf8');
if (/PRIVATE KEY|private_key|(?:BGG_TOKEN|client_secret|refresh_token|GOOGLE_CLIENT_SECRET|GOOGLE_REFRESH_TOKEN|TICKET_KEY)\s*[:=]/i.test(config)) throw new Error('A configuração contém uma possível credencial privada.');
await writeFile(resolve(target, '.nojekyll'), '');
const files = await readdir(target);
console.log(`Aplicativo estático preparado em ${target} (${files.length} entradas). Sem transpilar ou empacotar frameworks.`);
