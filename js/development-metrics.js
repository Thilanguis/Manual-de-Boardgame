// Contagens de operações lógicas, não uma estimativa de faturamento do Firestore.
export function instrumentFirestore(sdk, enabled) {
  if (!enabled) return sdk;
  const m = (globalThis.__ACERVO_METRICS__ ||= { reads: 0, writes: 0, activeListeners: 0, peakListeners: 0, listeners: {}, operations: {}, errors: {} });
  const path = (ref) => ref?.path || ref?._query?.path?.canonicalString?.() || 'transaction';
  const count = (kind, key, amount = 1) => {
    m[kind] += amount;
    m.operations[`${kind}:${key}`] = (m.operations[`${kind}:${key}`] || 0) + amount;
  };
  const wrapped = { ...sdk };
  for (const method of ['getDoc', 'getDocFromServer', 'getDocs', 'getDocsFromServer'])
    if (sdk[method])
      wrapped[method] = async (...args) => {
        const result = await sdk[method](...args);
        count('reads', path(args[0]), result.size ?? 1);
        return result;
      };
  wrapped.onSnapshot = (ref, ...args) => {
    const key = path(ref);
    let active = true;
    const stopCount = () => {
      if (active) {
        active = false;
        m.activeListeners--;
        m.listeners[key]--;
      }
    };
    m.activeListeners++;
    m.peakListeners = Math.max(m.peakListeners, m.activeListeners);
    m.listeners[key] = (m.listeners[key] || 0) + 1;
    const callbackIndex = args.findIndex((a) => typeof a === 'function'),
      callback = args[callbackIndex],
      error = args[callbackIndex + 1];
    args[callbackIndex] = (snapshot) => {
      if (!snapshot.metadata.fromCache) count('reads', key, snapshot.docChanges ? snapshot.docChanges().length : 1);
      callback(snapshot);
    };
    args[callbackIndex + 1] = (e) => {
      stopCount();
      m.errors[e.code || 'unknown'] = (m.errors[e.code || 'unknown'] || 0) + 1;
      error?.(e);
    };
    const stop = sdk.onSnapshot(ref, ...args);
    return () => {
      stopCount();
      stop();
    };
  };
  wrapped.runTransaction = (db, action, ...options) =>
    sdk.runTransaction(
      db,
      (tx) =>
        action({
          get: async (ref) => {
            count('reads', path(ref));
            return tx.get(ref);
          },
          set: (...args) => {
            count('writes', path(args[0]));
            tx.set(...args);
          },
          update: (...args) => {
            count('writes', path(args[0]));
            tx.update(...args);
          },
          delete: (...args) => {
            count('writes', path(args[0]));
            tx.delete(...args);
          },
        }),
      ...options,
    );
  for (const method of ['setDoc', 'updateDoc', 'deleteDoc', 'addDoc'])
    if (sdk[method])
      wrapped[method] = (...args) => {
        count('writes', path(args[0]));
        return sdk[method](...args);
      };
  return wrapped;
}
