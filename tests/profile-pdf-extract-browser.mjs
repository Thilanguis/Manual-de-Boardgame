// Leitura reproduzível do arquivo real fornecido ao teste, sempre sem rede externa.
export async function extractFixturePages(browser, bytes, base) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  try {
    await context.route('**/*', (r) => (['127.0.0.1', 'localhost'].includes(new URL(r.request().url()).hostname) ? r.continue() : r.abort()));
    await context.route('**/js/app.js', (r) => r.fulfill({ contentType: 'text/javascript', body: '' }));
    const page = await context.newPage();
    await page.goto(base);
    return await page.evaluate(async (base64) => {
      const { loadPdf } = await import('/js/pdf.js');
      const { linesFromItems } = await import('/js/recognition.js');
      const { textQuality } = await import('/js/text-quality.js');
      const pdf = await loadPdf(new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))]));
      try {
        const pages = [];
        for (let n = 1; n <= pdf.numPages; n++) {
          const page = await pdf.getPage(n),
            text = linesFromItems((await page.getTextContent()).items)
              .map((l) => l.text)
              .join('\n');
          pages.push({ page: n, text, quality: textQuality(text) });
          page.cleanup();
        }
        return pages;
      } finally {
        await pdf.destroy();
      }
    }, bytes.toString('base64'));
  } finally {
    await context.close();
  }
}
