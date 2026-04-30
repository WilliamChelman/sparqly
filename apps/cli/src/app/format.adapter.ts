import { blockSchemaFor, type EffectiveOptions } from './config/internal/schema';
import { formatZodIssues, type AdapterResult } from './cli-errors';

export interface FormatRawOptions {
  sources?: string;
  prefix?: string[];
  verbose?: boolean;
  quiet?: boolean;
  write?: boolean;
  check?: boolean;
}

export function formatAdapter(
  _passedParams: string[],
  options: FormatRawOptions,
): AdapterResult<Partial<EffectiveOptions>> {
  if (options.write && options.check) {
    return {
      errors: [
        {
          kind: 'invalid',
          message: '--write and --check are mutually exclusive',
        },
      ],
    };
  }

  const raw: Record<string, unknown> = {};
  if (options.sources !== undefined) raw.sources = options.sources;
  if (options.verbose !== undefined) raw.verbose = options.verbose;
  if (options.quiet !== undefined) raw.quiet = options.quiet;
  if (options.write !== undefined) raw.write = options.write;
  if (options.check !== undefined) raw.check = options.check;

  const prefixEntries = options.prefix ?? [];
  const prefixes: Record<string, string> = {};
  const errors: { kind: 'invalid'; message: string }[] = [];
  for (const entry of prefixEntries) {
    const eq = entry.indexOf('=');
    if (eq <= 0 || eq === entry.length - 1) {
      errors.push({
        kind: 'invalid',
        message: `--prefix '${entry}': expected name=<iri>`,
      });
      continue;
    }
    const name = entry.slice(0, eq);
    const iri = entry.slice(eq + 1);
    prefixes[name] = iri;
  }
  if (errors.length > 0) {
    return { errors };
  }
  if (Object.keys(prefixes).length > 0) {
    raw.prefixes = prefixes;
  }

  const parsed = blockSchemaFor('format').safeParse(raw);
  if (!parsed.success) {
    return { errors: formatZodIssues(parsed.error.issues, raw) };
  }

  return { cliOverrides: parsed.data as Partial<EffectiveOptions> };
}
