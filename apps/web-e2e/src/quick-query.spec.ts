import { expect, test } from '@playwright/test';

test.describe('query page · quick query menu', () => {
  test('picking CONSTRUCT from the Quick query menu seeds a templated body the user can run', async ({
    page,
  }) => {
    // The fixture context declares ex, rdf, rdfs (≥2 prefixes), so the menu's
    // emit must include a PREFIX header before the CONSTRUCT body.
    await page.goto('/');
    await expect(
      page.getByRole('heading', { level: 1, name: 'sparqly playground' }),
    ).toBeVisible();

    const trigger = page.getByRole('button', { name: /quick query/i });
    await expect(trigger).toBeVisible();
    await trigger.click();

    const construct = page.getByRole('menuitem', {
      name: /CONSTRUCT/,
    });
    await expect(construct).toBeVisible();
    await construct.click();

    // Assert the buffer via CodeMirror's view-model — YASQE renders into spans
    // so plain text assertions are fragile.
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
      .toMatch(/PREFIX ex:[\s\S]*CONSTRUCT/);

    await page.getByRole('button', { name: 'Run', exact: true }).click();

    // CONSTRUCT against alpha yields a triples result; the table tab is the
    // default landing tab and renders ex:alice / ex:bob from the fixture data.
    await expect(page.getByRole('tab', { name: 'table' })).toBeVisible();
    await expect(page.getByText('ex:alice').first()).toBeVisible();
    await expect(page.getByText('ex:bob').first()).toBeVisible();
  });
});
