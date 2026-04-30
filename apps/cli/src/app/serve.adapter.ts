import { blockSchemaFor, type EffectiveOptions } from './config/internal/schema';
import {
  formatZodIssues,
  mutableFromCli,
  type AdapterResult,
} from './cli-errors';

export interface ServeRawOptions {
  sources?: string;
  port?: number;
  graphStrategy?: string;
  mutable?: boolean;
  immutable?: boolean;
  verbose?: boolean;
  quiet?: boolean;
  watch?: boolean;
  watchDebounce?: number;
}

export function serveAdapter(
  _passedParams: string[],
  options: ServeRawOptions,
): AdapterResult<Partial<EffectiveOptions>> {
  const raw: Record<string, unknown> = {};
  if (options.sources !== undefined) raw.sources = options.sources;
  if (options.port !== undefined) raw.port = options.port;
  if (options.graphStrategy !== undefined)
    raw.graphStrategy = options.graphStrategy;
  if (options.watch !== undefined) raw.watch = options.watch;
  if (options.watchDebounce !== undefined)
    raw.watchDebounce = options.watchDebounce;
  if (options.verbose !== undefined) raw.verbose = options.verbose;
  if (options.quiet !== undefined) raw.quiet = options.quiet;
  const mutable = mutableFromCli(options);
  if (mutable !== undefined) raw.mutable = mutable;

  const parsed = blockSchemaFor('serve').safeParse(raw);
  if (!parsed.success) {
    return { errors: formatZodIssues(parsed.error.issues, raw) };
  }
  return { cliOverrides: parsed.data as Partial<EffectiveOptions> };
}
