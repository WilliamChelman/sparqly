import {
  getErrorBannerClasses,
  type ErrorBannerSize,
} from './error-banner.classes';

const SIZES: ReadonlyArray<ErrorBannerSize> = ['sm', 'md'];

describe('getErrorBannerClasses', () => {
  it('produces the golden class string for every size', () => {
    const matrix: Record<string, string> = {};
    for (const s of SIZES) {
      matrix[s] = getErrorBannerClasses(s);
    }
    expect(matrix).toMatchInlineSnapshot(`
      {
        "md": "flex items-start gap-2.5 rounded-lg border border-error-line bg-error-bg px-3.5 py-3 font-mono text-xs text-error",
        "sm": "rounded border border-error-line bg-error-bg p-2 text-sm text-error",
      }
    `);
  });
});
