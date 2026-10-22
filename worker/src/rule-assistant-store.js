import { RULE_ASSISTANT_LIMITS as limits } from '../../js/rule-assistant-contract.js';
const json = (value, status = 200) => Response.json(value, { status });
export async function assistantStore(storage, path, input) {
  const now = Date.now(),
    day = new Date(now).toISOString().slice(0, 10);
  return storage.transaction(async (tx) => {
    const appKey = `qa:budget:${day}`,
      userKey = `${appKey}:${input.uid}`;
    const app = (await tx.get(appKey)) || { used: 0, expiry: now + 2 * 86400000 };
    const user = (await tx.get(userKey)) || { used: 0, expiry: now + 2 * 86400000 };
    const usage = { used: user.used, limit: limits.perUserDay, dayUTC: day, applicationUsed: app.used, applicationLimit: limits.perAppDay, providerRemaining: null };
    const cacheKey = `qa:answer:${input.uid}:${input.key}`;
    const threadKey = `qa:thread:${input.uid}:${input.conversationId}`;
    const thread = await tx.get(threadKey);
    const activeThread = thread?.identity === input.identity && thread.expiry > now ? thread : { turns: [], identity: input.identity, expiry: now + 86400000 };
    if (path === '/assistant/read') return json({ history: activeThread.turns, usage });
    const locks = (await tx.get('qa:locks')) || { items: [], expiry: now + 86400000 };
    locks.items = locks.items.filter((lock) => lock.expires > now);
    if (path === '/assistant/finish') {
      const lock = locks.items.find((lock) => lock.uid === input.uid && lock.lease === input.lease);
      if (!lock) return json({ error: 'A pergunta expirou. Nenhuma repetição foi iniciada.' }, 409);
      locks.items = locks.items.filter((value) => value !== lock);
      await tx.put('qa:locks', locks);
      if (input.answer) {
        await tx.put(cacheKey, { answer: input.answer, expiry: now + 86400000 });
        activeThread.turns.push({ question: input.question, answer: input.answer });
        activeThread.turns = activeThread.turns.slice(-limits.turns);
        await tx.put(threadKey, activeThread);
      }
      return json({ usage });
    }
    if (!['/assistant/claim', '/assistant/cached'].includes(path)) return json({ error: 'Operação inválida.' }, 400);
    const saved = await tx.get(cacheKey);
    if (saved?.expiry > now) {
      if (activeThread.turns.at(-1)?.answer.id !== saved.answer.id) {
        activeThread.turns.push({ question: input.question, answer: saved.answer });
        activeThread.turns = activeThread.turns.slice(-limits.turns);
        await tx.put(threadKey, activeThread);
      }
      return json({ cached: true, answer: saved.answer, usage });
    }
    if (path === '/assistant/cached') return json({ cached: false, usage });
    if (locks.items.some((lock) => lock.uid === input.uid)) return json({ error: 'Já há uma pergunta em andamento para esta conta.' }, 409);
    if (locks.items.length >= limits.concurrent) return json({ error: 'O assistente está ocupado. A consulta tradicional continua disponível.' }, 429);
    if (activeThread.turns.length >= limits.turns) return json({ error: 'Esta conversa chegou a quatro perguntas. Inicie uma nova conversa para outro contexto.' }, 409);
    if (user.used >= limits.perUserDay || app.used >= limits.perAppDay) return json({ error: 'O orçamento diário das perguntas ao assistente foi atingido. A consulta dos PDFs e a análise de manuais continuam independentes.', usage }, 429);
    const lease = crypto.randomUUID();
    locks.items.push({ uid: input.uid, key: input.key, lease, expires: now + limits.timeoutMs + 15000 });
    user.used++;
    app.used++;
    usage.used++;
    usage.applicationUsed++;
    await tx.put(appKey, app);
    await tx.put(userKey, user);
    await tx.put('qa:locks', locks);
    return json({ claimed: true, lease, usage });
  });
}
export async function cleanAssistantStore(storage) {
  let cursor;
  do {
    const rows = await storage.list({ prefix: 'qa:', limit: 128, ...(cursor ? { startAfter: cursor } : {}) });
    for (const [key, value] of rows) {
      if (value.expiry <= Date.now()) await storage.delete(key);
      cursor = key;
    }
    if (rows.size < 128) break;
  } while (cursor);
}
