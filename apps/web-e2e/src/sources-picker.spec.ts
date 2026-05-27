import { expect, test } from '@playwright/test';

test.describe('source picker · no-git-history explainer', () => {
  test('opening the picker on a source whose glob has no git history renders the explainer and hides the free-form ref input', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(
      page.getByRole('heading', { level: 1, name: 'sparqly playground' }),
    ).toBeVisible();

    await page.getByTestId('sources-picker-trigger').click();
    const overlay = page.getByTestId('sources-overlay');
    await expect(overlay).toBeVisible();

    await overlay.locator('[data-source-id="epsilon"]').click();

    await expect(
      overlay.getByTestId('refs-panel-no-history'),
    ).toBeVisible();
    await expect(
      overlay.getByTestId('refs-panel-no-history'),
    ).toContainText('no git history');
    await expect(overlay.getByTestId('refs-search')).toHaveCount(0);
    await expect(overlay.locator('[data-section]')).toHaveCount(0);
  });
});
