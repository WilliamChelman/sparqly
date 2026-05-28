import { expect, test, type Page } from '@playwright/test';

const SLUG = 'e2e-create-list-load-run';
const BODY = 'SELECT ?s WHERE { ?s ?p ?o } LIMIT 1';

/** Best-effort cleanup: if a prior run left the entry, delete it. */
async function deleteIfPresent(page: Page, slug: string) {
  await page.goto(`/queries/${slug}`);
  const deleteBtn = page.getByRole('button', { name: 'Delete', exact: true });
  const notFound = page.getByText(`No saved query with slug "${slug}".`);
  // Wait until the page resolves either the loaded surface (entry exists) or
  // the not-found surface (clean slate) before deciding what to do.
  await Promise.race([
    deleteBtn.waitFor({ state: 'visible' }).catch(() => undefined),
    notFound.waitFor({ state: 'visible' }).catch(() => undefined),
  ]);
  if (await deleteBtn.isVisible().catch(() => false)) {
    page.once('dialog', (d) => void d.accept());
    await deleteBtn.click();
    await expect(page).toHaveURL(/\/queries(\?.*)?$/);
  }
}

test.describe('queries page · create → list → load → run', () => {
  test.beforeEach(async ({ page }) => {
    await deleteIfPresent(page, SLUG);
  });

  test.afterEach(async ({ page }) => {
    await deleteIfPresent(page, SLUG);
  });

  test('user can create, list, load, and run a Saved query', async ({
    page,
  }) => {
    // Create surface.
    await page.goto('/queries');
    await page.getByRole('button', { name: '+ New' }).click();
    await expect(page).toHaveURL(/\/queries\/new(\?.*)?$/);

    await page.getByLabel('Slug', { exact: true }).fill(SLUG);
    // YASQE wraps CodeMirror 5; driving the value via the CM API skips
    // bracket-autoclose surprises that would land if we typed `{` directly.
    await page
      .locator('.yasqe-editor-host .CodeMirror')
      .first()
      .evaluate((el, body) => {
        (el as unknown as { CodeMirror: { setValue: (s: string) => void } })
          .CodeMirror.setValue(body);
      }, BODY);

    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/queries/${SLUG}(\\?.*)?$`));

    // List — navigate to the index so the rail re-fetches from the server.
    await page.goto('/queries');
    const railEntry = page.getByRole('button', { name: SLUG, exact: true });
    await expect(railEntry).toBeVisible();

    // Load: clicking the rail entry surfaces the loaded-detail pane with the
    // slug heading and the run controls.
    await railEntry.click();
    await expect(
      page.getByRole('heading', { level: 2, name: SLUG }),
    ).toBeVisible();

    // Run — the sources picker auto-selects the default source on mount,
    // so the Run button is enabled out of the box.
    const runBtn = page.getByRole('button', { name: 'Run', exact: true });
    await expect(runBtn).toBeEnabled();
    await runBtn.click();

    // A successful run renders the result-pane tablist (table / raw / …).
    await expect(page.getByRole('tab', { name: 'table' })).toBeVisible();
  });
});
