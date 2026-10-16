import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { assertDevelopment, PROJECT, OWNER, FOLDER, AUTH, FIRESTORE, DIRECTORY } from './dev-config.mjs';
assertDevelopment();
export function testPdf(lines = ['Preparacao: distribua quatro cartas para cada jogador.', 'Turno: compre uma carta e mova seu barco ate duas casas.']) {
  const stream = `BT /F1 22 Tf 40 750 Td (Ilha dos Faroleiros - TESTE FICTICIO) Tj /F1 12 Tf ${lines.map((line) => `0 -36 Td (${line.replace(/[()\\]/g, '')}) Tj`).join(' ')} ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let text = '%PDF-1.4\n';
  const offsets = [0];
  for (const [i, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(text));
    text += `${i + 1} 0 obj\n${object}\nendobj\n`;
  }
  const start = Buffer.byteLength(text);
  text += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((n) => `${String(n).padStart(10, '0')} 00000 n \n`)
    .join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(text);
}
const value = (v) =>
  v === null
    ? { nullValue: null }
    : typeof v === 'boolean'
      ? { booleanValue: v }
      : typeof v === 'number'
        ? { integerValue: String(v) }
        : typeof v === 'string'
          ? { stringValue: v }
          : Array.isArray(v)
            ? { arrayValue: { values: v.map(value) } }
            : { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, value(x)])) } };
export async function seed({ reset = false } = {}) {
  const root = `http://${FIRESTORE}/v1/projects/${PROJECT}/databases/(default)/documents`;
  const headers = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
  if (reset) {
    for (const url of [`http://${FIRESTORE}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, `http://${AUTH}/emulator/v1/projects/${PROJECT}/accounts`]) {
      const response = await fetch(url, { method: 'DELETE' });
      if (!response.ok) throw new Error('Não foi possível restaurar os emuladores.');
    }
  } else if ((await fetch(`${root}/users/${OWNER}`, { headers })).ok) return;
  const write = async (path, data) => {
    const fields = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, ['createdAt', 'updatedAt'].includes(k) ? { timestampValue: new Date().toISOString() } : value(v)]));
    const response = await fetch(`${root}/${path}`, { method: 'PATCH', headers, body: JSON.stringify({ fields }) });
    if (!response.ok) throw new Error(`Seed ${path}: ${response.status} ${await response.text()}`);
  };
  for (const [uid, email, role, status] of [
    [OWNER, 'proprietario@acervo.test', 'superadmin', 'approved'],
    ['dev-subadmin', 'editor@acervo.test', 'subadmin', 'approved'],
    ['dev-reader', 'leitor@acervo.test', 'user', 'approved'],
    ['dev-pending', 'pendente@acervo.test', 'user', 'pending'],
    ['dev-blocked', 'bloqueado@acervo.test', 'user', 'blocked'],
  ]) {
    const response = await fetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts`, { method: 'POST', headers, body: JSON.stringify({ localId: uid, email, password: 'Acervo-teste-123', displayName: uid }) });
    if (!response.ok) throw new Error(`Seed Auth: ${response.status}`);
    await write(`users/${uid}`, {
      uid,
      email,
      name: uid,
      role,
      status,
      permissions: { approveUsers: role === 'superadmin', addGames: role !== 'user', editGames: role !== 'user', deleteGames: role === 'superadmin' },
      version: 1,
      lastEventId: '',
      createdAt: 0,
      updatedAt: 0,
    });
  }
  await write('settings/library', { publicRead: true, version: 1, lastEventId: '', updatedAt: 0 });
  const files = [];
  for (let i = 0; i < 3; i++) {
    const id = `10000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
      bytes = testPdf(),
      hash = Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
    const manual = { path: `games/${id}/manual.pdf`, name: 'Manual ficticio.pdf', type: 'application/pdf', size: bytes.length, pages: 1, sha256: hash, storage: 'drive', driveFileId: `dev-manual-${i}` };
    const coverId = `dev-cover-${i}`;
    const cover = await readFile(new URL('../tests/fixtures/development-cover.jpg', import.meta.url));
    const props = (kind) => ({ acervoProject: PROJECT, gameId: id, kind, sourceHash: hash });
    files.push(
      [manual.driveFileId, { bytes: bytes.toString('base64'), name: manual.name, mimeType: 'application/pdf', appProperties: props('manual') }],
      [coverId, { bytes: cover.toString('base64'), mimeType: 'image/jpeg', appProperties: props('cover') }],
    );
    const docs = { main: { id: 'main', name: 'Manual principal', documentType: 'principal', language: 'pt-BR', edition: 'Teste 1', manual } };
    if (i === 0) {
      const docId = '20000000-0000-4000-8000-000000000001',
        extra = testPdf(['Referencia: cada farol vale tres pontos no fim da partida.']),
        extraHash = Buffer.from(await crypto.subtle.digest('SHA-256', extra)).toString('hex'),
        fileId = 'dev-extra-0';
      docs[docId] = {
        id: docId,
        name: 'Referência rápida',
        documentType: 'referencia',
        language: 'pt-BR',
        edition: 'Teste 1',
        manual: { ...manual, path: `games/${id}/documents/${docId}.pdf`, name: 'Referencia.pdf', size: extra.length, sha256: extraHash, driveFileId: fileId },
      };
      files.push([fileId, { bytes: extra.toString('base64'), mimeType: 'application/pdf', appProperties: { ...props('document'), documentId: docId, sourceHash: extraHash } }]);
    }
    const game = {
      id,
      title: ['Ilha dos Faroleiros', 'Catan', 'Azul'][i],
      description: 'Jogo fictício de desenvolvimento. Distribua cartas, mova barcos e acenda faróis.',
      minPlayers: 2,
      maxPlayers: 4,
      durationMinutes: 30,
      minDurationMinutes: 30,
      maxDurationMinutes: 30,
      recommendedAge: 8,
      tags: ['Família'],
      mechanics: ['Gestão de mão'],
      gameType: 'Jogo base',
      language: 'pt-BR',
      edition: 'Teste 1',
      manual,
      cover: { path: `games/${id}/cover.jpg`, driveFileId: coverId, storage: 'drive' },
      documents: docs,
      primaryDocumentId: 'main',
      documentChanges: [],
      sources: {},
      schemaVersion: 1,
      isPublic: true,
      deleting: false,
      createdBy: OWNER,
      createdAt: 0,
      updatedAt: 0,
    };
    await write(`games/${id}`, game);
    for (const doc of Object.values(docs)) {
      const fileId = `dev-index-${i}-${doc.id}`;
      const text = doc.id === 'main' ? 'Preparacao: distribua quatro cartas para cada jogador. Turno: compre uma carta e mova seu barco ate duas casas.' : 'Referencia: cada farol vale tres pontos no fim da partida.';
      const index = {
        schemaVersion: 1,
        gameId: id,
        documentId: doc.id,
        sourceHash: doc.manual.sha256,
        pageCount: 1,
        language: 'pt-BR',
        pages: [{ page: 1, text, extracted: true }],
        headings: [{ title: 'Preparação', page: 1, category: 'Preparação', source: 'Manual fictício de teste' }],
        analysisComplete: true,
        revision: 1,
      };
      files.push([fileId, { bytes: gzipSync(JSON.stringify(index)).toString('base64'), mimeType: 'application/gzip', appProperties: { ...props('documentIndex'), documentId: doc.id, sourceHash: doc.manual.sha256 } }]);
      await write(`games/${id}/indexes/${doc.id}`, { documentId: doc.id, sourceHash: doc.manual.sha256, fileId, state: 'ready', readablePages: 1, translatedPages: 1, revision: 1, updatedAt: 0 });
    }
    const section = { id: crypto.randomUUID(), title: 'Preparação', text: 'Distribua quatro cartas para cada participante.', type: 'texto', page: 1, documentId: 'main', sourceHash: hash, reviewed: true, language: 'pt-BR' };
    const guide = { gameId: id, schemaVersion: 1, revision: 1, content: JSON.stringify([section]), sourceHash: hash, assets: {}, indexFileId: '', reviewed: true, updatedAt: 0, updatedBy: OWNER };
    await write(`gameGuides/${id}`, guide);
    await write(`guideDrafts/${id}`, { ...guide, reviewed: false, content: JSON.stringify([{ ...section, text: 'Rascunho privado: conferir a preparação.', reviewed: false }]) });
  }
  await mkdir(DIRECTORY, { recursive: true });
  await writeFile(resolve(DIRECTORY, 'files.json'), JSON.stringify(files));
  console.log('Dados fictícios preparados. Contas @acervo.test; senha: Acervo-teste-123.');
}
