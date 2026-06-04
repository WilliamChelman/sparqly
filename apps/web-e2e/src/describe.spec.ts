import { expect, test } from '@playwright/test';

test.describe('describe page · single-source picker', () => {
  test('lands on the default source and describes a seed against it', async ({
    page,
  }) => {
    await page.goto('/describe');
    await expect(
      page.getByRole('heading', { level: 1, name: 'describe' }),
    ).toBeVisible();

    // ADR-0052: the picker is mandatory single-select — it auto-selects the
    // registry's default source (`alpha`) on landing, writes it to the URL,
    // and offers no cleared/all state.
    const picker = page.getByRole('button', { name: /^source/ });
    await expect(picker).toContainText('alpha');
    await expect(page).toHaveURL(/[?&]source=alpha(?:&|$)/);
    await expect(
      page.locator('[data-testid="sources-picker-clear"]'),
    ).toHaveCount(0);

    // Fixture: alpha.ttl has `ex:bob` with two outbound quads (a Person, label)
    // and one inbound quad (ex:alice ex:knows ex:bob), so the seed exercises
    // both halves of the section split.
    await page.getByLabel('seed IRI').fill('ex:bob');
    await page.getByRole('button', { name: 'Describe' }).click();

    await expect(
      page.getByRole('heading', { level: 2, name: /^outbound/ }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 2, name: /^inbound/ }),
    ).toBeVisible();
    await expect(page.getByText(/3 quad\(s\)\./)).toBeVisible();

    // The URL is rewritten with the fully-expanded seed on submit so the page
    // is bookmarkable.
    await expect(page).toHaveURL(/[?&]iri=http(?::|%3A)%2F%2Fexample\.org%2Fbob/);

    // ADR-0053: the document title carries the described seed as a curie.
    await expect(page).toHaveTitle('ex:bob — Describe — sparqly');
  });

  test('picking another source rescopes the page and rewrites the URL', async ({
    page,
  }) => {
    // ex:alice exists in alpha.ttl only. Picking `beta` rescopes the describe
    // to a source where alice has no quads — proving the picker's selection
    // rides both the request and the URL.
    await page.goto('/describe');

    await page.getByRole('button', { name: /^source/ }).click();
    await page.getByRole('dialog').getByText('beta', { exact: true }).click();
    await page.getByRole('button', { name: 'Apply' }).click();

    // Selecting a source rescopes the page immediately — the URL carries the
    // explicit `?source=beta` before the describe even runs.
    await expect(page).toHaveURL(/[?&]source=beta(?:&|$)/);

    await page.getByLabel('seed IRI').fill('ex:alice');
    await page.getByRole('button', { name: 'Describe' }).click();

    // Beta has no quads about alice → the response renders the empty marker.
    await expect(page.getByText('No quads.')).toBeVisible();
  });
});
