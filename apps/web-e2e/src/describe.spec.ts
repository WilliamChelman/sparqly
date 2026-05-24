import { expect, test } from '@playwright/test';

test.describe('describe page · seed → outbound + inbound', () => {
  test('describes a seed IRI and renders both outbound and inbound sections', async ({
    page,
  }) => {
    await page.goto('/describe');
    await expect(
      page.getByRole('heading', { level: 1, name: 'describe' }),
    ).toBeVisible();

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

    // The total ticker reports the merged quad count from the merged response.
    await expect(page.getByText(/3 quad\(s\)\./)).toBeVisible();

    // The URL is rewritten with the fully-expanded seed on submit so the page
    // is bookmarkable.
    await expect(page).toHaveURL(/[?&]iri=http(?::|%3A)%2F%2Fexample\.org%2Fbob/);
  });

  test('scopes the describe to a single source when the picker carries a value', async ({
    page,
  }) => {
    // ex:alice exists in alpha.ttl only. Selecting `beta` from the source
    // picker scopes the describe to a source where alice has no quads — a
    // single positive case proving the picker's selection rides the request
    // (and the URL).
    await page.goto('/describe');

    await page.getByRole('button', { name: /^source/ }).click();
    await page.getByRole('dialog').getByText('beta', { exact: true }).click();
    await page.getByRole('button', { name: 'Apply' }).click();

    await page.getByLabel('seed IRI').fill('ex:alice');
    await page.getByRole('button', { name: 'Describe' }).click();

    await expect(page).toHaveURL(/[?&]source=beta(?:&|$)/);
    // Beta has no quads about alice → the response renders the empty marker.
    await expect(page.getByText('No quads.')).toBeVisible();
  });
});
