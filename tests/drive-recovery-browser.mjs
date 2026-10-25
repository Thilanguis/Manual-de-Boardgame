// SDK/HTTP inteiramente simulados; exercita repositório Firebase e interface reais.
import '../scripts/test-guard.mjs';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { browserDependencies } from './browser-dependencies.mjs';
const { chromium } = browserDependencies('playwright');
const base = process.env.ACERVO_TEST_URL || 'http://127.0.0.1:4186';
const output = 'test-output/drive-recovery';
await mkdir(output, { recursive: true });
const image = await readFile('assets/icon-192.png');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const external = [],
  errors = [];
let connected = false,
  reads = 0;
const config = {
  firebase: { projectId: 'demo-acervo' },
  ownerUid: 'fixture-owner',
  sdkBase: '/fixture-sdk',
  emulators: { auth: 'http://127.0.0.1:9099', host: '127.0.0.1', port: 8080 },
  fileStorage: { apiBase: base + '/fixture-drive' },
  maxPdfBytes: 52428800,
};
const sdk = {
  'firebase-app.js': 'export const initializeApp=()=>({});',
  'firebase-auth.js': `const user={uid:'fixture-owner',email:'owner@example.test',providerData:[],getIdToken:async()=> 'fixture-jwt'}; export const getAuth=()=>({currentUser:user}); export const connectAuthEmulator=()=>{}; export const onAuthStateChanged=(auth,callback)=>{setTimeout(()=>callback(user),0);return ()=>{};};`,
  'firebase-firestore.js': `
    export const memoryLocalCache=()=>({}), initializeFirestore=()=>({}),connectFirestoreEmulator=()=>{};
    export const doc=(db,...parts)=>({path:parts.join('/'),type:'doc'}),collection=(db,...parts)=>({path:parts.join('/'),type:'collection'}),where=()=>({}),query=(ref)=>ref;
    const profile={uid:'fixture-owner',name:'Proprietário simulado',status:'approved',role:'superadmin',permissions:{}};
    const games=Array.from({length:20},(_,i)=>({id:(i+1).toString(16).padStart(8,'0')+'-1234-1234-1234-123456789abc',title:'Jogo preservado '+(i+1),description:'Ficha existente',isPublic:true,manual:{driveFileId:'manual'+i,name:'manual.pdf',pages:1,sha256:'a'.repeat(64)},cover:{driveFileId:'cover'+i}}));
    const snapshot=(data)=>({exists:()=>true,data:()=>({...data}),metadata:{fromCache:false}});
    export const getDocFromServer=async ref=>snapshot(ref.path==='settings/library'?{publicRead:true}:profile);
    export const onSnapshot=(ref,...args)=>{const callback=args.find(a=>typeof a==='function');let active=true;
      if(ref.path.startsWith('users/')) globalThis.fixtureBlock=()=>{profile.status='blocked';callback(snapshot(profile));};
      setTimeout(()=>{if(!active)return; callback(ref.type==='collection'?{docs:(ref.path==='games'?games:[]).map(g=>({id:g.id,data:()=>g})),size:ref.path==='games'?games.length:0,metadata:{fromCache:false},docChanges:()=>ref.path==='games'?[{type:'added'}]:[]}:snapshot(ref.path==='settings/library'?{publicRead:true}:profile));},0); return()=>{active=false;};};
  `,
};
try {
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 1000 } });
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin === new URL(base).origin) return route.continue();
    if (url.origin === 'http://127.0.0.1:8080' && url.pathname.includes('/cacheKeys/')) return route.fulfill({ status: 403, json: { error: 'cache intentionally disabled' } });
    external.push(url.origin);
    return route.abort();
  });
  await context.route('**/config/app-config.js', (route) => route.fulfill({ contentType: 'text/javascript', body: `export const APP_CONFIG=${JSON.stringify(config)};` }));
  await context.route('**/fixture-sdk/*', (route) => route.fulfill({ contentType: 'text/javascript', body: sdk[route.request().url().split('/').at(-1)] }));
  await context.route('**/fixture-drive/**', async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    if (path.endsWith('/health')) return route.fulfill({ json: { fileProtocol: 2, manualAiEnabled: false, driveOAuth: { configured: true, verified: false } } });
    assert.equal(request.headers().authorization, 'Bearer fixture-jwt');
    assert(!/knowledge|rule-question/.test(path), 'nenhuma solicitação Gemini, nem simulada, neste cenário');
    reads++;
    if (!connected) return route.fulfill({ status: 503, json: { error: 'fixture', code: 'drive/oauth-expired', retryAfter: 60 } });
    if (path.endsWith('/catalog/status')) return route.fulfill({ json: { games: request.postDataJSON().gameIds.map((id) => ({ id, available: true })) } });
    assert(path.endsWith('/cover'));
    return route.fulfill({ contentType: 'image/png', body: image });
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.stack));
  await page.goto(base);
  await page.waitForFunction(() => !document.getElementById('drive-warning').hidden);
  assert.equal(await page.locator('.game-card').count(), 20);
  assert.match(await page.locator('#drive-diagnostic').innerText(), /proprietário precisa renovar/);
  assert(await page.locator('#cover-warning').isHidden());
  assert(await page.locator('#library-error').isHidden());
  assert.equal(reads, 1, 'uma única sonda antes de interromper o lote');
  await page.screenshot({ path: output + '/oauth-warning-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  connected = true;
  await page.locator('#retry-drive').click();
  await page.waitForFunction(() => document.getElementById('drive-warning').hidden && [...document.querySelectorAll('.game-card img')].every((i) => i.hasAttribute('src') && !i.hidden));
  await page.locator('.game-card').first().scrollIntoViewIfNeeded();
  await page.waitForFunction(() => document.querySelector('.game-card img')?.naturalWidth > 0);
  assert.equal(await page.locator('.game-card').count(), 20);
  assert(await page.locator('#library-error').isHidden());
  await page.screenshot({ path: output + '/recovered-mobile.png' });
  const beforeBlock = reads;
  await page.evaluate(() => globalThis.fixtureBlock());
  await page.waitForFunction(() => !document.body.classList.contains('access-approved'));
  assert.equal(await page.locator('.game-card').count(), 0);
  assert.equal(reads, beforeBlock, 'bloqueio do perfil não provoca leitura Drive');
  for (const path of ['sobre.html', 'privacidade.html', 'termos.html']) {
    const publicPage = await context.newPage();
    await publicPage.goto(base + '/' + path);
    assert.equal(await publicPage.locator('script').count(), 0);
    for (const width of [390, 768, 1440]) {
      await publicPage.setViewportSize({ width, height: 900 });
      assert(await publicPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    await publicPage.close();
  }
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
  console.log('PASS: catálogo Firebase simulado preservado, uma sonda 503, aviso administrativo, comparação sem segredo, recuperação das capas, bloqueio de perfil, páginas públicas sem SDK e layouts 390/768/1440. Sem serviços externos ou Gemini.');
} finally {
  await browser.close();
}
