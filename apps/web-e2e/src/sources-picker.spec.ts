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

    // Commits live behind the Commits tab.
    await overlay.getByTestId('tab-commits').click();

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

test.describe('source picker · Commits scope selector', () => {
  test('default scope is HEAD; selecting "All refs" re-fetches and renders the new rows', async ({
    page,
  }) => {
    const HEAD_SHA = 'a'.repeat(40);
    const SIDE_SHA = 'b'.repeat(40);
    const iso = new Date().toISOString();

    await page.route('**/api/sources/alpha/refs', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          head: { ref: 'HEAD', kind: 'head', sha: HEAD_SHA },
          branches: [{ ref: 'main', kind: 'branch', sha: HEAD_SHA }],
          remoteBranches: [],
          tags: [],
        }),
      });
    });
    await page.route('**/api/sources/alpha/commits**', async (route) => {
      const url = new URL(route.request().url());
      const ref = url.searchParams.get('ref');
      if (ref === 'HEAD') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            commits: [
              {
                sha: HEAD_SHA,
                shortSha: HEAD_SHA.slice(0, 7),
                subject: 'head-only change',
                authorName: 'A',
                authorDate: iso,
                parents: [],
              },
            ],
            nextBefore: null,
          }),
        });
      } else if (ref === '__all__') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            commits: [
              {
                sha: SIDE_SHA,
                shortSha: SIDE_SHA.slice(0, 7),
                subject: 'side-only change',
                authorName: 'A',
                authorDate: iso,
                parents: [],
              },
              {
                sha: HEAD_SHA,
                shortSha: HEAD_SHA.slice(0, 7),
                subject: 'head-only change',
                authorName: 'A',
                authorDate: iso,
                parents: [],
              },
            ],
            nextBefore: null,
          }),
        });
      } else {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'invalid-scope' }),
        });
      }
    });

    await page.goto('/');
    await page.getByTestId('sources-picker-trigger').click();
    const overlay = page.getByTestId('sources-overlay');
    await expect(overlay).toBeVisible();

    await overlay.locator('[data-source-id="alpha"]').click();

    // Commits live behind the Commits tab.
    await overlay.getByTestId('tab-commits').click();

    await expect(overlay.locator('[data-section="commits"]')).toBeVisible();

    const scope = overlay.getByTestId('commits-scope-select');
    await expect(scope).toHaveValue('HEAD');

    await expect(overlay.locator('[data-commit-sha]')).toHaveCount(1);

    await scope.selectOption('__all__');

    await expect(overlay.locator('[data-commit-sha]')).toHaveCount(2);
    await expect(
      overlay.locator(`[data-commit-sha="${SIDE_SHA}"]`),
    ).toBeVisible();
  });
});

test.describe('source picker · empty-scope hint', () => {
  test('HEAD scope with zero commits renders the "all refs" affordance; clicking it flips the selector and reveals commits', async ({
    page,
  }) => {
    const SIDE_SHA = 'c'.repeat(40);
    const HEAD_SHA = 'd'.repeat(40);
    const iso = new Date().toISOString();

    await page.route('**/api/sources/alpha/refs', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          head: { ref: 'HEAD', kind: 'head', sha: HEAD_SHA },
          branches: [{ ref: 'main', kind: 'branch', sha: HEAD_SHA }],
          remoteBranches: [],
          tags: [],
        }),
      });
    });
    await page.route('**/api/sources/alpha/commits**', async (route) => {
      const url = new URL(route.request().url());
      const ref = url.searchParams.get('ref');
      if (ref === 'HEAD') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ commits: [], nextBefore: null }),
        });
      } else if (ref === '__all__') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            commits: [
              {
                sha: SIDE_SHA,
                shortSha: SIDE_SHA.slice(0, 7),
                subject: 'side-branch change',
                authorName: 'A',
                authorDate: iso,
                parents: [],
              },
            ],
            nextBefore: null,
          }),
        });
      } else {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'invalid-scope' }),
        });
      }
    });

    await page.goto('/');
    await page.getByTestId('sources-picker-trigger').click();
    const overlay = page.getByTestId('sources-overlay');
    await expect(overlay).toBeVisible();

    await overlay.locator('[data-source-id="alpha"]').click();

    // Commits live behind the Commits tab.
    await overlay.getByTestId('tab-commits').click();

    // Empty-scope hint is visible with no rows
    await expect(overlay.getByTestId('commits-empty-hint')).toBeVisible();
    await expect(overlay.locator('[data-commit-sha]')).toHaveCount(0);

    // Click "all refs" → selector flips → row appears
    await overlay.getByTestId('commits-empty-hint-action').click();

    await expect(overlay.getByTestId('commits-scope-select')).toHaveValue(
      '__all__',
    );
    await expect(
      overlay.locator(`[data-commit-sha="${SIDE_SHA}"]`),
    ).toBeVisible();
  });
});

test.describe('source picker · Commits pagination (Show more)', () => {
  test('clicking "Show more" issues a follow-up /commits request with `before` and appends the next page', async ({
    page,
  }) => {
    const PAGE1_FIRST = '1'.repeat(40);
    const PAGE1_LAST = 'a'.repeat(40);
    const PAGE2_LAST = '2'.repeat(40);
    const iso = new Date().toISOString();

    await page.route('**/api/sources/alpha/refs', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          head: { ref: 'HEAD', kind: 'head', sha: PAGE1_FIRST },
          branches: [{ ref: 'main', kind: 'branch', sha: PAGE1_FIRST }],
          remoteBranches: [],
          tags: [],
        }),
      });
    });
    await page.route('**/api/sources/alpha/commits**', async (route) => {
      const url = new URL(route.request().url());
      const before = url.searchParams.get('before');
      if (before === null) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            commits: [
              {
                sha: PAGE1_FIRST,
                shortSha: PAGE1_FIRST.slice(0, 7),
                subject: 'one',
                authorName: 'A',
                authorDate: iso,
                parents: [],
              },
              {
                sha: PAGE1_LAST,
                shortSha: PAGE1_LAST.slice(0, 7),
                subject: 'two',
                authorName: 'A',
                authorDate: iso,
                parents: [],
              },
            ],
            nextBefore: PAGE1_LAST,
          }),
        });
      } else if (before === PAGE1_LAST) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            commits: [
              {
                sha: PAGE2_LAST,
                shortSha: PAGE2_LAST.slice(0, 7),
                subject: 'three',
                authorName: 'A',
                authorDate: iso,
                parents: [],
              },
            ],
            nextBefore: null,
          }),
        });
      } else {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'invalid-before' }),
        });
      }
    });

    await page.goto('/');
    await page.getByTestId('sources-picker-trigger').click();
    const overlay = page.getByTestId('sources-overlay');
    await expect(overlay).toBeVisible();

    await overlay.locator('[data-source-id="alpha"]').click();

    // Commits live behind the Commits tab.
    await overlay.getByTestId('tab-commits').click();

    await expect(overlay.locator('[data-section="commits"]')).toBeVisible();
    await expect(overlay.locator('[data-commit-sha]')).toHaveCount(2);

    const showMore = overlay.getByTestId('commits-show-more');
    await expect(showMore).toBeVisible();
    await showMore.click();

    // Next page appended; Show more disappears (final page).
    await expect(overlay.locator('[data-commit-sha]')).toHaveCount(3);
    await expect(
      overlay.locator(`[data-commit-sha="${PAGE2_LAST}"]`),
    ).toBeVisible();
    await expect(overlay.getByTestId('commits-show-more')).toHaveCount(0);
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
