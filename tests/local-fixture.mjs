// Opt-in exclusivo da fixture; o app publicado não permite contornar a entrada.
const installed = new WeakSet();
export async function enableLocalFixture(context) {
  if (installed.has(context)) return;
  installed.add(context);
  await context.route('**/config/app-config.js', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()) + '\nAPP_CONFIG.allowLocalDevelopment=true;\n' });
  });
}
