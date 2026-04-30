import { blockSchemaFor, type EffectiveOptions } from './config/internal/schema';
import { formatZodIssues, type AdapterResult } from './cli-errors';

export interface HashRawOptions {
  sources?: string[];
  graphStrategy?: string;
  json?: boolean;
  compareWith?: string;
  verbose?: boolean;
  quiet?: boolean;
}

export function hashAdapter(
  _passedParams: string[],
  options: HashRawOptions,
): AdapterResult<Partial<EffectiveOptions>> {
  const raw: Record<string, unknown> = {};
  if (options.sources !== undefined) raw.sources = options.sources;
  if (options.graphStrategy !== undefined)
    raw.graphStrategy = options.graphStrategy;
  if (options.json !== undefined) raw.json = options.json;
  if (options.compareWith !== undefined) raw.compareWith = options.compareWith;
  if (options.verbose !== undefined) raw.verbose = options.verbose;
  if (options.quiet !== undefined) raw.quiet = options.quiet;

  const parsed = blockSchemaFor('hash').safeParse(raw);
  if (!parsed.success) {
    return { errors: formatZodIssues(parsed.error.issues, raw) };
  }
  return { cliOverrides: parsed.data as Partial<EffectiveOptions> };
}
