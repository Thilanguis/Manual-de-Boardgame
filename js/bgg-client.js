// Fonte opcional: falhas do BGG nunca impedem importar os dados do PDF.
export async function requestBgg(endpoint, getToken, input, { timeoutMs = 25000, signal } = {}) {
  const timeout = AbortSignal.timeout(timeoutMs),
    combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let abort;
  try {
    const token = await Promise.race([
      getToken(),
      new Promise((_, reject) => {
        abort = () => reject(combined.reason);
        if (combined.aborted) abort();
        else combined.addEventListener('abort', abort, { once: true });
      }),
    ]);
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(input),
      signal: combined,
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Não foi possível consultar o BGG.');
    return result;
  } catch (error) {
    if (timeout.aborted) throw new Error('O BoardGameGeek demorou a responder. Tente novamente ou continue com os dados do PDF.');
    throw error;
  } finally {
    if (abort) combined.removeEventListener('abort', abort);
  }
}
