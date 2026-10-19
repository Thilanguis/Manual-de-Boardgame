import { catalogPlans } from './io.js';
import { wikidataEntities } from './wikidata.js';
import { queryVariants, titleMatches } from '../../../js/game-identities.js';
import { normalizeText } from '../../../js/model.js';
import { wikiInfobox } from './wiki-infobox.js';

export async function wikipedia(input, io) {
  const diagnostics = (input.diagnostics = { queries: [], failures: [], complete: true, returned: 0 });
  const variants = queryVariants(input);
  const plans = ['pt', 'en', 'fr'].map((language) => variants.find((v) => v.language === language && language !== 'pt' && normalizeText(v.query) !== normalizeText(input.query)) || variants.find((v) => v.language === language)).filter(Boolean);
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
      prop: 'pageprops|extracts|info|revisions',
      rvprop: 'ids|content',
      rvslots: 'main',
      rvsection: '0',
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
    const revision = article.revisions?.[0];
    const infobox = wikiInfobox(revision?.slots?.main?.content || revision?.['*']);
    // Correspondência precisa existir em nomes da entidade ou título do artigo.
    const query = normalizeText(input.query),
      names = [article.title, ...entity.names.map((n) => n.value)].map(normalizeText);
    const searches = [query, ...(input.alternateTitles || []).map((name) => normalizeText(name.value))];
    if (!searches.some((term) => names.some((name) => name === term))) continue;
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
      names: [...entity.names, { value: article.title, language: article.language, origin: 'artigo vinculado ao mesmo item Wikidata' }],
      source: 'wikipedia',
      discoveryOnly: !titleMatches(entity, input),
      url: url.href,
      fields: { title: article.title, ...(description ? { description } : {}), ...infobox.fields },
      fieldEvidence: Object.fromEntries(
        Object.entries(infobox.evidence).map(([key, excerpt]) => [key, { excerpt, ...(revision?.revid ? { revision: revision.revid, url: `https://${article.language}.wikipedia.org/w/index.php?oldid=${revision.revid}` } : {}) }]),
      ),
      language: article.language,
      descriptionLanguage: article.language,
      fieldLanguages: { title: article.language, description: article.language },
      license: 'CC BY-SA 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
      authorsUrl: url.href + '&action=history',
      attribution: 'Autores da Wikipédia · introdução e fatos da ficha técnica',
      modified: true,
      fieldReasons: Object.fromEntries(
        ['minPlayers', 'maxPlayers', 'recommendedAge', 'minDurationMinutes', 'maxDurationMinutes', 'mechanics', 'tags', 'gameType', 'edition']
          .filter((field) => infobox.fields[field] == null)
          .map((field) => [field, 'Este campo não foi extraído: a ficha técnica não fornece um valor inequívoco utilizável.']),
      ),
    });
  }
  diagnostics.complete = diagnostics.failures.length === 0;
  diagnostics.returned = candidates.length;
  return candidates;
}
