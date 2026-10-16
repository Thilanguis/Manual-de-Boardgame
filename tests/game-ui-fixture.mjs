export async function openGameManagement(page, section) {
  if (!(await page.locator('#game-management-dialog').evaluate((d) => d.open))) await page.locator('#detail-admin').click();
  await page.locator(`[data-game-management="${section}"]`).click();
}
