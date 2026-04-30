import type { z } from 'zod';
import type { CommandName } from './config/internal/schema';

export type AdapterErrorKind =
  | 'unknown-flag'
  | 'positional-overflow'
  | 'invalid';

export interface AdapterError {
  kind: AdapterErrorKind;
  message: string;
}

export type AdapterResult<T> =
  | { cliOverrides: T }
  | { errors: AdapterError[] };

export function isAdapterFailure<T>(
  r: AdapterResult<T>,
): r is { errors: AdapterError[] } {
  return (r as { errors?: AdapterError[] }).errors !== undefined;
}

const FIELD_TO_FLAG: Record<string, string> = {
  graphStrategy: '--graph-strategy',
  format: '--format',
  sources: '--sources',
  queryFile: '--query-file',
  query: '--query',
  port: '--port',
  watch: '--watch',
  watchDebounce: '--watch-debounce',
  compareWith: '--compare-with',
  json: '--json',
  mutable: '--mutable',
  immutable: '--immutable',
  left: '--left',
  right: '--right',
  verbose: '--verbose',
  quiet: '--quiet',
  prefixes: '--prefix',
  base: '--base',
};

export function formatZodIssues(
  issues: ReadonlyArray<z.core.$ZodIssue>,
  rawValues: Record<string, unknown>,
): AdapterError[] {
  return issues.map((issue) => {
    const key = String(issue.path[0] ?? '');
    const flag = FIELD_TO_FLAG[key] ?? `--${key}`;
    if (issue.code === 'invalid_value' && Array.isArray(issue.values)) {
      const offered = rawValues[key];
      const expected = issue.values.join(', ');
      return {
        kind: 'unknown-flag',
        message: `unknown ${flag} '${String(offered)}' (expected ${expected})`,
      };
    }
    return { kind: 'invalid', message: `${flag}: ${issue.message}` };
  });
}

export function exitCodeFor(
  command: CommandName,
  context: { hashCompareMode?: boolean } = {},
): number {
  if (command === 'diff') return 2;
  if (command === 'hash') return context.hashCompareMode ? 2 : 1;
  return 1;
}

export function mutableFromCli(options: {
  mutable?: boolean;
  immutable?: boolean;
}): boolean | undefined {
  if (options.mutable === true) return true;
  if (options.immutable !== undefined) return options.immutable === false;
  return undefined;
}
