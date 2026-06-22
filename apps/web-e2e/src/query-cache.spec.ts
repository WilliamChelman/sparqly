import { expect, test, type Page } from '@playwright/test';

async function setEditorBody(page: Page, body: string) {
  await page
    .locator('.yasqe-editor-host .CodeMirror')
    .first()
    .evaluate((el, value) => {
      (el as unknown as { CodeMirror: { setValue: (s: string) => void } })
        .CodeMirror.setValue(value);
    }, body);
}

/** The cached indicator the result pane shows on an `X-Sparqly-Cache: hit`. */
function cachedBadge(page: Page) {
  return page.getByRole('status').filter({ hasText: 'cached' });
}

test.describe('query page · Query cache indicator + force refresh (ADR-0054, #418)', () => {
  test('a repeat run shows the cached indicator; Force refresh recomputes', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(
      page.getByRole('heading', { level: 1, name: 'sparqly playground' }),
    ).toBeVisible();

    // The Query cache persists across serve runs (and the local Playwright
    // webServer is reused), so probe with a per-run query text to make the
    // first execution a guaranteed fresh computation.
    await setEditorBody(
      page,
      `SELECT ?s WHERE { ?s ?p ?o . FILTER(?s != <urn:probe:${Date.now()}>) } LIMIT 10`,
    );

    const runBtn = page.getByRole('button', { name: 'Run', exact: true });
    await runBtn.click();
    await expect(page.getByRole('tab', { name: 'table' })).toBeVisible();
    await expect(page.getByText('ex:alice').first()).toBeVisible();
    // Freshly computed — no cached indicator.
    await expect(cachedBadge(page)).toHaveCount(0);

    // An identical re-run answers from the cache and says so.
    await runBtn.click();
    await expect(cachedBadge(page)).toBeVisible();

    // Force refresh recomputes: the indicator drops while the result returns.
    await page.getByRole('button', { name: 'Force refresh' }).click();
    await expect(page.getByText('ex:alice').first()).toBeVisible();
    await expect(cachedBadge(page)).toHaveCount(0);

    // The refresh replaced the stored entry — a plain re-run hits again.
    await runBtn.click();
    await expect(cachedBadge(page)).toBeVisible();
  });
});
