import { expect, test } from '@playwright/test';

test.describe('source picker · Commits section', () => {
  test('opening the picker on a glob with history renders the Commits section; clicking a row pins to the full SHA', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(
      page.getByRole('heading', { level: 1, name: 'sparqly playground' }),
    ).toBeVisible();

    await page.getByTestId('sources-picker-trigger').click();
    const overlay = page.getByTestId('sources-overlay');
    await expect(overlay).toBeVisible();

    await overlay.locator('[data-source-id="alpha"]').click();

    // Commits section renders with at least one row touching alpha.ttl
    await expect(overlay.locator('[data-section="commits"]')).toBeVisible();
    const rows = overlay.locator('[data-commit-sha]');
    await expect(rows.first()).toBeVisible();
    const sha = await rows.first().getAttribute('data-commit-sha');
    expect(sha).toMatch(/^[0-9a-f]{40}$/);

    // Click the row → URL receives @alpha:<40-hex>
    await rows.first().click();
    await page.waitForFunction(
      (expected) => window.location.search.includes(expected),
      `@alpha:${sha}`,
    );

    // Trigger chip shows the SHA (short form is a prefix)
    const chip = page.getByTestId('pinned-ref-chip');
    await expect(chip).toBeVisible();
    await expect(chip).toContainText(sha!.slice(0, 7));

    // No floating-ref banner — 40-hex SHA is reproducible.
    await expect(page.getByTestId('floating-ref-note')).toHaveCount(0);
  });
});

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
