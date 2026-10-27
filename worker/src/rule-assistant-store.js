import { RULE_ASSISTANT_LIMITS as limits } from '../../js/rule-assistant-contract.js';
const json = (value, status = 200) => Response.json(value, { status });
export async function assistantStore(storage, path, input) {
  const now = Date.now();
  return storage.transaction(async (tx) => {
    const cacheKey = `qa:answer:${input.uid}:${input.key}`;
    const threadKey = `qa:thread:${input.uid}:${input.conversationId}`;
    const thread = await tx.get(threadKey);
    const activeThread = thread?.identity === input.identity && thread.expiry > now ? thread : { turns: [], identity: input.identity, expiry: now + 86400000 };
    if (path === '/assistant/read') return json({ history: activeThread.turns });
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
        activeThread.turns = activeThread.turns.slice(-limits.historyTurns);
        await tx.put(threadKey, activeThread);
      }
      return json({});
    }
    if (!['/assistant/claim', '/assistant/cached'].includes(path)) return json({ error: 'Operação inválida.' }, 400);
    const saved = await tx.get(cacheKey);
    if (saved?.expiry > now) {
      if (activeThread.turns.at(-1)?.answer.id !== saved.answer.id) {
        activeThread.turns.push({ question: input.question, answer: saved.answer });
        activeThread.turns = activeThread.turns.slice(-limits.historyTurns);
        await tx.put(threadKey, activeThread);
      }
      return json({ cached: true, answer: saved.answer });
    }
    if (path === '/assistant/cached') return json({ cached: false });
    // Evita repetir a mesma geração simultânea; perguntas diferentes não têm teto global.
    if (locks.items.some((lock) => lock.uid === input.uid && lock.key === input.key)) return json({ error: 'Esta pergunta já está em andamento. Aguarde a resposta.' }, 409);
    const lease = crypto.randomUUID();
    locks.items.push({ uid: input.uid, key: input.key, lease, expires: now + limits.timeoutMs + 15000 });
    await tx.put('qa:locks', locks);
    return json({ claimed: true, lease });
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
