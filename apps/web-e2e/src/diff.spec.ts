import { expect, test, type Page } from '@playwright/test';

const TABULAR_QUERY = 'SELECT ?s WHERE { ?s a <http://example.org/Person> }';
const CONSTRUCT_SCOPE_QUERY =
  'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o } LIMIT 1';

async function pickSideSource(page: Page, side: 'left' | 'right', id: string) {
  await page.getByRole('button', { name: new RegExp(`^${side}`, 'i') }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByText(id, { exact: true }).click();
  await dialog.getByRole('button', { name: 'Apply' }).click();
}

async function pickRightSource(page: Page, id: string) {
  await pickSideSource(page, 'right', id);
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

test.describe('diff page · pre-flight gate for raw pass-through sources (#375)', () => {
  test('raw disk-backed glob on left, empty query → Run disabled and hint names the source', async ({
    page,
  }) => {
    await page.goto('/diff');
    await pickSideSource(page, 'left', 'gamma');

    const hint = page.getByTestId('scoping-query-hint-left');
    await expect(hint).toBeVisible();
    await expect(hint).toContainText('gamma');
    await expect(
      page.getByRole('button', { name: 'Run', exact: true }),
    ).toBeDisabled();
  });

  test('typing a CONSTRUCT scoping query on the disk-backed side clears the hint and re-enables Run', async ({
    page,
  }) => {
    await page.goto('/diff');
    await pickSideSource(page, 'left', 'gamma');

    const runBtn = page.getByRole('button', { name: 'Run', exact: true });
    await expect(runBtn).toBeDisabled();

    await setEditorBody(page, 'left', CONSTRUCT_SCOPE_QUERY);

    await expect(page.getByTestId('scoping-query-hint-left')).toHaveCount(0);
    await expect(runBtn).toBeEnabled();
  });

  test('raw endpoint on right, empty query → Run disabled, hint shown; query re-enables Run', async ({
    page,
  }) => {
    await page.goto('/diff');
    await pickSideSource(page, 'right', 'delta');

    const hint = page.getByTestId('scoping-query-hint-right');
    await expect(hint).toBeVisible();
    await expect(hint).toContainText('delta');

    const runBtn = page.getByRole('button', { name: 'Run', exact: true });
    await expect(runBtn).toBeDisabled();

    await setEditorBody(page, 'right', CONSTRUCT_SCOPE_QUERY);

    await expect(page.getByTestId('scoping-query-hint-right')).toHaveCount(0);
    await expect(runBtn).toBeEnabled();
  });
});
