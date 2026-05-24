import { expect, test, type Page } from '@playwright/test';

/**
 * Locate a source card by the visible id text. The card is the only
 * `<li>` on `/sources` that carries the id as visible text, so a
 * substring `hasText` is enough to disambiguate.
 */
function sourceRow(page: Page, id: string) {
  return page.getByRole('listitem').filter({ hasText: id });
}

test.describe('sources page · per-source lifecycle', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/sources');
    // The Unload step at the end of the previous test leaves the row in
    // `not-loaded`, but a stray run that bailed early could leave it
    // elsewhere — wait until the page has finished its first paint.
    await expect(
      page.getByRole('heading', { level: 1, name: 'sources' }),
    ).toBeVisible();
  });

  test('load → loaded, reload → loaded, unload → not-loaded', async ({
    page,
  }) => {
    const row = sourceRow(page, 'alpha');
    await expect(row).toBeVisible();

    // If a prior test in the suite left `alpha` loaded, normalise to
    // `not-loaded` before the assertions below — the goal here is the
    // user-visible transition, not the boot state.
    if (await row.getByRole('button', { name: 'Unload' }).isVisible()) {
      await row.getByRole('button', { name: 'Unload' }).click();
      await expect(row.getByText('not-loaded', { exact: true })).toBeVisible();
    }

    await expect(row.getByText('not-loaded', { exact: true })).toBeVisible();

    await row.getByRole('button', { name: 'Load' }).click();
    await expect(row.getByText('loaded', { exact: true })).toBeVisible();

    await row.getByRole('button', { name: 'Reload' }).click();
    await expect(row.getByText('loaded', { exact: true })).toBeVisible();

    await row.getByRole('button', { name: 'Unload' }).click();
    await expect(row.getByText('not-loaded', { exact: true })).toBeVisible();
  });
});
