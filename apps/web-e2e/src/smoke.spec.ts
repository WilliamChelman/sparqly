import { expect, test } from '@playwright/test';

test.describe('per-page smoke', () => {
  test('/ renders the query playground', async ({ page }) => {
    await page.goto('/');
    await expect(
      page.getByRole('heading', { level: 1, name: 'sparqly playground' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Run' })).toBeVisible();
  });

  test('/diff renders the diff page', async ({ page }) => {
    await page.goto('/diff');
    await expect(
      page.getByRole('heading', { level: 1, name: 'diff' }),
    ).toBeVisible();
  });

  test('/describe renders the describe page', async ({ page }) => {
    await page.goto('/describe');
    await expect(
      page.getByRole('heading', { level: 1, name: 'describe' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Describe' })).toBeVisible();
  });

  test('/queries renders the saved-queries page', async ({ page }) => {
    await page.goto('/queries');
    await expect(
      page.getByRole('heading', { level: 1, name: 'saved queries' }),
    ).toBeVisible();
    await expect(
      page.getByText('Select an entry to view its body.'),
    ).toBeVisible();
  });

  test('/sources renders the sources page', async ({ page }) => {
    await page.goto('/sources');
    await expect(
      page.getByRole('heading', { level: 1, name: 'sources' }),
    ).toBeVisible();
  });
});
