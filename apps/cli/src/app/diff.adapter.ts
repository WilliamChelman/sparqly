import { blockSchemaFor, type EffectiveOptions } from './config/internal/schema';
import { formatZodIssues, type AdapterResult } from './cli-errors';

export interface DiffRawOptions {
  left?: string;
  right?: string;
  graphStrategy?: string;
  format?: string;
  verbose?: boolean;
  quiet?: boolean;
}

export function diffAdapter(
  passedParams: string[],
  options: DiffRawOptions,
): AdapterResult<Partial<EffectiveOptions>> {
  if (passedParams.length > 2) {
    return {
      errors: [
        {
          kind: 'positional-overflow',
          message: `diff takes at most two positional arguments (got ${passedParams.length})`,
        },
      ],
    };
  }

  const raw: Record<string, unknown> = {};
  if (passedParams[0] !== undefined) raw.left = passedParams[0];
  if (passedParams[1] !== undefined) raw.right = passedParams[1];
  if (options.left !== undefined) raw.left = options.left;
  if (options.right !== undefined) raw.right = options.right;
  if (options.graphStrategy !== undefined)
    raw.graphStrategy = options.graphStrategy;
  if (options.format !== undefined) raw.format = options.format;
  if (options.verbose !== undefined) raw.verbose = options.verbose;
  if (options.quiet !== undefined) raw.quiet = options.quiet;

  const parsed = blockSchemaFor('diff').safeParse(raw);
  if (!parsed.success) {
    return { errors: formatZodIssues(parsed.error.issues, raw) };
  }
  return { cliOverrides: parsed.data as Partial<EffectiveOptions> };
}
