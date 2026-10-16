import { catalogPlans } from './io.js';
import { wikidataEntities } from './wikidata.js';
import { queryVariants } from '../../../js/game-identities.js';
import { normalizeText } from '../../../js/model.js';

export async function wikipedia(input, io) {
  const diagnostics = (input.diagnostics = { queries: [], failures: [], complete: true, returned: 0 });
  const plans = queryVariants(input)
    .filter((v, i, all) => all.findIndex((p) => p.language === v.language) === i)
    .slice(0, 3);
  const responses = await catalogPlans(plans, async (plan) => {
    const url = new URL(`https://${plan.language}.wikipedia.org/w/api.php`);
    url.search = new URLSearchParams({
      format: 'json',
      formatversion: '2',
      action: 'query',
      generator: 'search',
      gsrsearch: plan.query,
      gsrnamespace: '0',
      gsrlimit: '3',
      prop: 'pageprops|extracts|info',
      exintro: '1',
      explaintext: '1',
      exlimit: '3',
      inprop: 'url',
    });
    const result = await io(url.href);
    diagnostics.queries.push({ ...plan, status: 'ok', rawCount: result.query?.pages?.length || 0 });
    return (result.query?.pages || []).map((page) => ({ ...page, language: plan.language }));
  });
  responses.forEach((r, i) => {
    if (r.status === 'rejected') diagnostics.failures.push({ ...plans[i], error: r.reason.message });
  });
  const pages = responses
    .filter((r) => r.status === 'fulfilled')
    .flatMap((r) => r.value)
    .filter((p) => /^Q[1-9]\d{0,10}$/.test(p.pageprops?.wikibase_item || '') && !('disambiguation' in (p.pageprops || {})));
  const ids = [...new Set(pages.map((p) => p.pageprops.wikibase_item))];
  const entities = await wikidataEntities(ids, input, io),
    candidates = [];
  for (const entity of entities) {
    const articles = pages.filter((p) => p.pageprops.wikibase_item === entity.id);
    const article = articles.find((p) => p.language === (input.preferredLanguage === 'pt-BR' ? 'pt' : input.preferredLanguage)) || articles.find((p) => p.language === input.pdfLanguage) || articles[0];
    if (!article) continue;
    // Correspondência precisa existir em nomes da entidade ou título do artigo.
    const query = normalizeText(input.query),
      names = [article.title, ...entity.names.map((n) => n.value)].map(normalizeText);
    const searches = [query, ...(input.alternateTitles || []).map((name) => normalizeText(name.value))];
    if (!searches.some((term) => names.some((name) => name === term || (term.length >= 5 && (name.includes(term) || term.includes(name)))))) continue;
    const url = new URL(`https://${article.language}.wikipedia.org/w/index.php`);
    url.searchParams.set('curid', article.pageid);
    const description =
      String(article.extract || '')
        .split(/\n/)
        .map((v) => v.trim())
        .find((v) => v.length > 40)
        ?.slice(0, 1100) || '';
    candidates.push({
      ...entity,
      source: 'wikipedia',
      url: url.href,
      fields: { title: article.title, ...(description ? { description } : {}) },
      language: article.language,
      descriptionLanguage: article.language,
      fieldLanguages: { title: article.language, description: article.language },
      license: 'CC BY-SA 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
      authorsUrl: url.href + '&action=history',
      attribution: 'Autores da Wikipédia · trecho da introdução',
      modified: true,
      fieldReasons: Object.fromEntries(
        ['minPlayers', 'maxPlayers', 'recommendedAge', 'durationMinutes', 'mechanics', 'tags', 'gameType', 'edition'].map((field) => [field, 'Este conector utiliza somente título e introdução do artigo; este campo não foi extraído.']),
      ),
    });
  }
  diagnostics.complete = diagnostics.failures.length === 0;
  diagnostics.returned = candidates.length;
  return candidates;
}
