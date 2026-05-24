import { expect, test, type Page } from '@playwright/test';

const TABULAR_QUERY = 'SELECT ?s WHERE { ?s a <http://example.org/Person> }';

async function pickRightSource(page: Page, id: string) {
  await page.getByRole('button', { name: new RegExp(`^right`, 'i') }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByText(id, { exact: true }).click();
  await dialog.getByRole('button', { name: 'Apply' }).click();
}

async function setEditorBody(page: Page, side: 'left' | 'right', body: string) {
  await page
    .locator(`[data-testid="editor-${side}"] .yasqe-editor-host .CodeMirror`)
    .first()
    .evaluate((el, value) => {
      (el as unknown as { CodeMirror: { setValue: (s: string) => void } })
        .CodeMirror.setValue(value);
    }, body);
}

test.describe('diff page · graph + tabular happy paths', () => {
  test('graph diff between two ttl sources renders hunks and totals', async ({
    page,
  }) => {
    // Fixtures: alpha.ttl declares ex:alice + ex:bob; beta.ttl declares
    // ex:carol + ex:dave. With empty SELECTs the server takes the graph-diff
    // path and produces fully-removed left hunks and fully-added right hunks.
    await page.goto('/diff');
    await expect(
      page.getByRole('heading', { level: 1, name: 'diff' }),
    ).toBeVisible();

    await pickRightSource(page, 'beta');
    await page.getByRole('button', { name: 'Run', exact: true }).click();

    await expect(page.getByTestId('diff-totals')).toBeVisible();
    // alpha has 5 quads, beta has 5 quads, none shared → +5 -5.
    await expect(page.getByTestId('diff-totals')).toContainText('+5 -5');
    // The hunk list renders at least one anchored hunk per side.
    await expect(page.getByTestId('hunk').first()).toBeVisible();
  });

  test('tabular diff between two SELECTs renders the row delta table', async ({
    page,
  }) => {
    // Identical SELECT projections on both sides flip the dispatch to tabular.
    // alpha → {alice, bob}; beta → {carol, dave}; bag-difference yields the
    // tabular delta the row table renders.
    await page.goto('/diff');
    await pickRightSource(page, 'beta');
    await setEditorBody(page, 'left', TABULAR_QUERY);
    await setEditorBody(page, 'right', TABULAR_QUERY);

    await page.getByRole('button', { name: 'Run', exact: true }).click();

    await expect(page.getByTestId('tabular-diff')).toBeVisible();
    // 2 rows added (carol, dave) and 2 removed (alice, bob).
    await expect(page.getByTestId('diff-totals')).toContainText('+2 -2');
  });
});
