import test from 'node:test';
import assert from 'node:assert/strict';
import { createTextTranslator, translationChunks, translatedValue, translateIndex } from '../js/translation.js';
import { portugueseCandidate, translateCatalogCandidate, pdfMetadataCandidate } from '../js/catalog-language.js';
import { consolidateCandidates } from '../js/research-knowledge.js';
import { suggestedSections } from '../js/pdf-index.js';
import { searchRules, cleanGuide, emptyGuide } from '../js/guide-model.js';

function fixture() {
  const records = new Map(),
    calls = [];
  const cache = async (key, value) => {
    if (value) records.set(key, value);
    return records.get(key);
  };
  const provider = {
    availability: async () => 'available',
    create: async () => ({
      targetLanguage: 'pt',
      translate: async (text) => {
        calls.push(text);
        return `Português: ${text}`;
      },
      destroy() {},
    }),
  };
  return { records, calls, provider, cache, translator: createTextTranslator({ provider, cache, scope: 'private:user:hash-A' }) };
}
test('tradução de texto longo preserva todo o original, divide a carga e reutiliza o cache sem chamar o motor', async () => {
  const { translator, calls, provider, cache } = fixture();
  const original = 'A complete paragraph about the rules and their limitations.\n'.repeat(100);
  assert.equal(translationChunks(original).join(''), original);
  assert(translationChunks(original).every((part) => part.length <= 1600));
  const first = await translator.translate(original, { sourceLanguage: 'en' });
  assert.equal(first.sourceText, original);
  assert.equal(first.targetLanguage, 'pt-BR');
  assert.equal(first.actualTargetLanguage, 'pt');
  const count = calls.length;
  assert(count > 1);
  const afterReload = createTextTranslator({ provider, cache, scope: 'private:user:hash-A' });
  assert.deepEqual(await afterReload.translate(original, { sourceLanguage: 'en' }), first);
  assert.equal(calls.length, count);
  assert.equal(translatedValue(first, 'texto alterado'), '');
  const otherScope = createTextTranslator({ provider, cache, scope: 'private:other-user:hash-A' });
  await otherScope.translate(original, { sourceLanguage: 'en' });
  assert(calls.length > count, 'cache privado não atravessa contas/contextos');
});
test('sem suporte não existe envio remoto; download de idioma exige ação explícita', async () => {
  let creates = 0;
  const translator = createTextTranslator({
    provider: {
      availability: async () => 'downloadable',
      create: async () => {
        creates++;
        return { translate: async () => 'Olá' };
      },
    },
    cache: async () => null,
  });
  await assert.rejects(translator.translate('Hello', { sourceLanguage: 'en' }), /Clique em Traduzir/);
  assert.equal(creates, 0);
  await translator.prepare('en', { allowDownload: true });
  assert.equal((await translator.translate('Hello', { sourceLanguage: 'en' })).text, 'Olá');
  const unsupported = createTextTranslator({ provider: null, cache: async () => null });
  await assert.rejects(unsupported.translate('Hello', { sourceLanguage: 'en' }), /indisponível/);
});
test('tradução progressiva guarda páginas concluídas, retoma e nunca altera o texto do PDF', async () => {
  const { translator, calls } = fixture(),
    controller = new AbortController();
  const index = { language: 'en', pages: [1, 2].map((page) => ({ page, text: `Original rule page ${page}.` })), headings: [] };
  await assert.rejects(translateIndex(index, translator, { signal: controller.signal, checkpoint: async () => controller.abort() }));
  assert(index.pages[0].translation);
  assert.equal(index.pages[1].translation, undefined);
  await translateIndex(index, translator);
  assert.equal(calls.length, 2);
  assert.equal(index.pages[0].text, 'Original rule page 1.');
});
test('catálogo exibe apenas PT, conserva os originais e aplica tradução completa com proveniência', async () => {
  const { translator } = fixture();
  const candidate = {
    source: 'wikipedia',
    id: '42',
    kind: 'base',
    edition: '',
    language: 'fr',
    names: [{ value: 'Título oficial', language: 'pt-BR' }],
    fields: { title: 'Original title', description: 'Une description complète à vérifier avec les règles officielles.', tags: ['Strategy'], mechanics: ['Une mécanique spécifique'] },
  };
  const pending = portugueseCandidate(candidate);
  assert.equal(pending.fields.description, undefined);
  assert.deepEqual(pending.fields.tags, ['Estratégia']);
  assert.equal(pending.pendingTranslations.length, 2);
  const next = await translateCatalogCandidate(candidate, translator);
  const [merged] = consolidateCandidates([next]);
  assert.equal(merged.pendingTranslations.length, 0);
  assert.equal(merged.fieldSources.description.language, 'pt-BR');
  assert.equal(merged.fieldSources.description.originalLanguage, 'fr');
  assert.equal(merged.fieldSources.description.originalValue, candidate.fields.description);
  assert.equal(candidate.fields.description.startsWith('Une'), true);
  assert.equal(merged.fields.title, 'Título oficial');
});
test('consulta pesquisa o texto traduzido completo e retorna português com a página e o original', () => {
  const original = 'Move the survivor to the hallway. Each turn allows two actions.';
  const index = {
    sourceHash: 'a',
    language: 'en',
    pages: [{ page: 1, text: original, translation: { targetLanguage: 'pt-BR', sourceText: original, text: 'Mova o sobrevivente para o corredor. Cada turno permite duas ações.' } }],
    headings: [{ page: 1, title: 'TURN', category: 'Turnos' }],
  };
  const [result] = searchRules(index, null, 'sobrevivente corredor', { currentHash: 'a' });
  assert.equal(result.page, 1);
  assert.match(result.text, /Mova o sobrevivente/);
  assert.equal(result.originalText, original);
  assert.equal(result.translated, true);
  assert.equal(searchRules(index, null, 'corredor', { currentHash: 'b' }).length, 0);
  delete index.pages[0].translation;
  const [pending] = searchRules(index, null, 'hallway', { currentHash: 'a' });
  assert(pending.needsTranslation);
  assert.equal(pending.text, '');
});
test('páginas sem títulos oferecem sugestões; texto estrangeiro pendente não pode ser publicado como revisado', () => {
  const index = { language: 'en', pages: [{ page: 1, text: 'An original explanation of the turn, with no heading in this document.' }], headings: [] };
  const suggestions = suggestedSections(index);
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].title, 'Página 1');
  assert.equal(suggestions[0].text, '');
  assert(suggestions[0].translationPending);
  assert(suggestions[0].originalText);
  const guide = cleanGuide({ ...emptyGuide({ id: 'test', manual: { sha256: 'a' } }), sections: suggestions.map((s) => ({ ...s, reviewed: true })) });
  assert.equal(guide.reviewed, false);
});
test('tradução de metadados do próprio PDF só é reaproveitada para o hash original', () => {
  const game = {
    title: 'Jogo',
    language: 'en',
    manual: { sha256: 'a'.repeat(64) },
    sources: {
      pdfOriginalMetadata: {
        manualHash: 'a'.repeat(64),
        language: 'en',
        fields: { description: 'Original English description.' },
        translations: { description: { sourceValue: 'Original English description.', value: 'Descrição revisada em português.', targetLanguage: 'pt-BR', method: 'manual' } },
      },
    },
  };
  assert.equal(portugueseCandidate(pdfMetadataCandidate(game)).fields.description, 'Descrição revisada em português.');
  assert.equal(pdfMetadataCandidate({ ...game, manual: { sha256: 'b'.repeat(64) } }), null);
  delete game.sources.pdfOriginalMetadata.manualHash;
  assert.equal(pdfMetadataCandidate(game), null);
});
