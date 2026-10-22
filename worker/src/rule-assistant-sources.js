import { ruleMatch } from '../../js/rule-relevance.js';
import { textQuality } from '../../js/text-quality.js';

export async function boundedText(response, limit = 100000) {
  if (!response.body) return '';
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let size = 0,
    text = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        throw new Error('Fonte excede o limite.');
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}
// Somente fontes registradas no servidor, com permissão explícita de reutilização.
// O navegador nunca fornece URL e não há Google Search Grounding ou SSRF genérico.
export async function externalRuleEvidence(game, question, env, signal, fetcher = fetch) {
  let configured;
  try {
    configured = JSON.parse(env.RULE_ASSISTANT_OFFICIAL_SOURCES || '[]');
  } catch {
    return { status: 'unavailable', evidence: [] };
  }
  const sources = Array.isArray(configured)
    ? configured.filter((s) => s.gameId === game.id && (s.edition || '') === (game.edition || '') && s.official === true && s.reuseAllowed === true && typeof s.license === 'string' && s.license.trim()).slice(0, 3)
    : [];
  if (!sources.length) return { status: 'unavailable', evidence: [] };
  const evidence = [];
  let failed = false;
  for (const source of sources) {
    if (evidence.length >= 6) break;
    try {
      const url = new URL(source.url);
      if (url.protocol !== 'https:' || url.username || url.password || url.port || !/^[a-z][a-z0-9.-]*\.[a-z]{2,}$/i.test(url.hostname) || /(?:localhost|\.local|\.internal)$/i.test(url.hostname)) throw new Error();
      const response = await fetcher(url.href, { redirect: 'error', signal, headers: { Accept: 'text/html,text/plain' } });
      if (!response.ok || !/^text\/(?:html|plain)/i.test(response.headers.get('Content-Type') || '')) throw new Error();
      const html = await boundedText(response);
      const text = html
        .replace(/<(script|style|head|nav|footer)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
        .replace(/<\/(?:p|div|li|h[1-6])>|<br\s*\/?>/gi, '\n')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
      for (const paragraph of text
        .split('\n')
        .map((s) => s.replace(/\s+/g, ' ').trim())
        .filter((s) => s.length >= 20 && s.length <= 1500 && !textQuality(s).corrupt)) {
        const match = ruleMatch(question, '', paragraph);
        if (match.score <= 0) continue;
        evidence.push({
          id: `official-${evidence.length + 1}`,
          text: paragraph,
          source: 'official',
          name: String(source.name || url.hostname).slice(0, 160),
          url: url.href,
          license: source.license.slice(0, 160),
          score: match.score,
          checkedAt: Date.now(),
        });
        if (evidence.length >= 6) break;
      }
    } catch {
      if (signal.aborted) throw new DOMException('Cancelado', 'AbortError');
      failed = true;
    }
  }
  return { status: failed ? 'partial' : evidence.length ? 'searched' : 'no-match', evidence: evidence.sort((a, b) => b.score - a.score).slice(0, 6) };
}
