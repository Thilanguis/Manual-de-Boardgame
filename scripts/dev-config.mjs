import { fileURLToPath } from 'node:url';
export const PROJECT = 'demo-acervo';
export const OWNER = 'dev-acervo-owner';
export const FOLDER = 'dev-acervo-folder';
export const AUTH = '127.0.0.1:9099';
export const FIRESTORE = '127.0.0.1:8080';
export const DIRECTORY = fileURLToPath(new URL('../test-output/development', import.meta.url));
export function assertDevelopment() {
  if (process.env.GCLOUD_PROJECT && process.env.GCLOUD_PROJECT !== PROJECT) throw new Error('Projeto externo bloqueado.');
  for (const [name, value] of [
    ['FIRESTORE_EMULATOR_HOST', FIRESTORE],
    ['FIREBASE_AUTH_EMULATOR_HOST', AUTH],
  ]) {
    if (process.env[name] && process.env[name] !== value) throw new Error(`${name}: endpoint externo bloqueado.`);
    process.env[name] = value;
  }
  process.env.GCLOUD_PROJECT = PROJECT;
}
