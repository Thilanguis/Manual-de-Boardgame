import { createRequire } from 'node:module';
import { resolve } from 'node:path';
export const browserDependencies = createRequire(process.env.ACERVO_TEST_MODULES ? resolve(process.env.ACERVO_TEST_MODULES, 'package.json') : new URL('./runtime/package.json', import.meta.url));
