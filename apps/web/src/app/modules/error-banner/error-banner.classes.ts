export type ErrorBannerSize = 'sm' | 'md';

const SM =
  'rounded border border-error-line bg-error-bg p-2 text-sm text-error';
const MD =
  'flex items-start gap-2.5 rounded-lg border border-error-line bg-error-bg px-3.5 py-3 font-mono text-xs text-error';

const SHAPES: Record<ErrorBannerSize, string> = {
  sm: SM,
  md: MD,
};

export function getErrorBannerClasses(size: ErrorBannerSize): string {
  return SHAPES[size];
}
