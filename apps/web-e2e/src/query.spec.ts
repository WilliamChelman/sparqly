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

test.describe('query page · run + saved-query slug', () => {
  test('Run posts a SELECT against the alpha source and renders at least one row', async ({
    page,
  }) => {
    // The fixture config defaults the source picker to "alpha", which carries
    // five known triples (ex:alice + ex:bob with three predicates between them).
    await page.goto('/');
    await expect(
      page.getByRole('heading', { level: 1, name: 'sparqly playground' }),
    ).toBeVisible();

    await setEditorBody(page, 'SELECT ?s WHERE { ?s ?p ?o } LIMIT 10');

    const runBtn = page.getByRole('button', { name: 'Run', exact: true });
    await expect(runBtn).toBeEnabled();
    await runBtn.click();

    // The result-pane flips to the table tab once a result arrives.
    await expect(page.getByRole('tab', { name: 'table' })).toBeVisible();
    // The two subjects (ex:alice, ex:bob) appear in the rendered cells.
    await expect(page.getByText('ex:alice').first()).toBeVisible();
    await expect(page.getByText('ex:bob').first()).toBeVisible();
  });

  test('loading a saved query via ?savedQuery=<slug> populates the editor and runs', async ({
    page,
  }) => {
    // Fixture .sparqly-queries.yaml seeds slug `spo` with a basic ?s ?p ?o
    // SELECT LIMIT 10. Booting with the slug in the URL should load the body
    // into the editor, pin the slug on the library combobox, and let Run fire
    // against the default source without further user input.
    await page.goto('/?savedQuery=spo');

    // The editor surfaces the loaded body; assert via CodeMirror's view-model
    // rather than typing-stable DOM (which YASQE renders into spans).
    await expect
      .poll(async () =>
        page
          .locator('.yasqe-editor-host .CodeMirror')
          .first()
          .evaluate(
            (el) =>
              (
                el as unknown as { CodeMirror: { getValue: () => string } }
              ).CodeMirror.getValue(),
          ),
      )
      .toContain('SELECT ?s ?p ?o');

    await page.getByRole('button', { name: 'Run', exact: true }).click();

    await expect(page.getByRole('tab', { name: 'table' })).toBeVisible();
    // alpha contributes ex:alice / ex:bob as subjects under the spo SELECT.
    await expect(page.getByText('ex:alice').first()).toBeVisible();
  });
});
