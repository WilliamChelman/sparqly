import { blockSchemaFor, type EffectiveOptions } from './config/internal/schema';
import {
  formatZodIssues,
  mutableFromCli,
  type AdapterResult,
} from './cli-errors';

export interface QueryRawOptions {
  sources?: string;
  query?: string;
  queryFile?: string;
  format?: string;
  graphStrategy?: string;
  mutable?: boolean;
  immutable?: boolean;
  verbose?: boolean;
  quiet?: boolean;
  out?: string;
}

export function queryAdapter(
  _passedParams: string[],
  options: QueryRawOptions,
): AdapterResult<Partial<EffectiveOptions>> {
  const raw: Record<string, unknown> = {};
  if (options.sources !== undefined) raw.sources = options.sources;
  if (options.query !== undefined) raw.query = options.query;
  if (options.queryFile !== undefined) raw.queryFile = options.queryFile;
  if (options.format !== undefined) raw.format = options.format;
  if (options.graphStrategy !== undefined)
    raw.graphStrategy = options.graphStrategy;
  if (options.verbose !== undefined) raw.verbose = options.verbose;
  if (options.quiet !== undefined) raw.quiet = options.quiet;
  if (options.out !== undefined) raw.out = options.out;
  const mutable = mutableFromCli(options);
  if (mutable !== undefined) raw.mutable = mutable;

  const parsed = blockSchemaFor('query').safeParse(raw);
  if (!parsed.success) {
    return { errors: formatZodIssues(parsed.error.issues, raw) };
  }

  return { cliOverrides: parsed.data as Partial<EffectiveOptions> };
}
