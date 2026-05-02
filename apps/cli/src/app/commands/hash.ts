import { createHash } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import {
  canonicalizeRdf,
  parseSourceSpec,
  type GraphMode,
  type SourceSpecInput,
} from 'core';
import { configureLogger } from '../logging';
import { writeOutputToFile } from '../output';
import type { FieldDescriptor } from '../runner/field';
import {
  coercedBooleanSchema,
  graphModeFieldFor,
  outFieldFor,
  sourcesField,
  verbosityFieldsFor,
} from '../runner/fields-shared';
import type { CommandSpec } from '../runner/spec';

interface HashConfig {
  sources?: string | string[];
  graphMode?: GraphMode;
  json?: boolean;
  compareWith?: string;
  out?: string;
  verbose?: boolean;
  quiet?: boolean;
}

class HashMismatchSignal extends Error {
  readonly silent = true;
  constructor(message: string) {
    super(message);
    this.name = 'HashMismatchSignal';
  }
}

class HashCompareError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HashCompareError';
  }
}

const compareWithField: FieldDescriptor = {
  key: 'compareWith',
  schema: z.string(),
  env: ['SPARQLY_HASH_COMPARE_WITH'],
  flags: [
    {
      spec: '--compare-with <source>',
      description:
        "Hash a second source spec (file path or glob) with the same loader options and compare against the primary source. Exit 0 on match (stdout 'match: <hash>'), 1 on mismatch (stdout shows both labeled hashes), 2 on error. Requires exactly one primary source. SPARQL endpoint sources are rejected on this side (use a `view` source kind to scope an endpoint).",
    },
  ],
};

const jsonField: FieldDescriptor = {
  key: 'json',
  schema: coercedBooleanSchema,
  default: false,
  env: ['SPARQLY_HASH_JSON'],
  flags: [
    {
      spec: '--json',
      description:
        'Emit a JSON array of { source, hash } objects in input order instead of the default <hash>  <source-spec> lines. Not applicable in --compare-with mode.',
    },
  ],
};

export const hashSpec: CommandSpec<HashConfig> = {
  name: 'hash',
  description:
    'Compute a stable SHA-256 over the canonicalized RDF content of one or more sources. Always materializes; a SPARQL endpoint source is rejected (wrap it in a `view` source kind to scope it). Determinism caveat: a remote endpoint can return different data between runs, so a SPARQL hash is only as deterministic as the endpoint.',
  fields: [
    sourcesField,
    graphModeFieldFor('hash'),
    jsonField,
    compareWithField,
    outFieldFor('hash'),
    ...verbosityFieldsFor('hash'),
  ],
  positionals: [{ field: 'sources', name: 'glob' }],
  refine: (schema) =>
    (schema as z.ZodObject).superRefine(
      (val: Record<string, unknown>, ctx) => {
        const sources = val.sources;
        if (sources !== undefined) {
          const list: SourceSpecInput[] = Array.isArray(sources)
            ? (sources as SourceSpecInput[])
            : [sources as SourceSpecInput];
          list.forEach((entry, i) => {
            const violation = rawEndpoint(entry);
            if (violation) {
              ctx.addIssue({
                code: 'custom',
                message: `SPARQL endpoint ${violation} cannot be hashed directly (hash always materializes; wrap the endpoint in a \`view\` source kind to scope it, or pipe \`sparqly query --format=turtle\` into \`sparqly hash\`)`,
                path: ['sources', i],
              });
            }
          });
        }
        const compareWith = val.compareWith;
        if (typeof compareWith === 'string') {
          const violation = rawEndpoint(compareWith);
          if (violation) {
            ctx.addIssue({
              code: 'custom',
              message: `SPARQL endpoint ${violation} cannot be hashed directly (hash always materializes; wrap the endpoint in a \`view\` source kind to scope it, or pipe \`sparqly query --format=turtle\` into \`sparqly hash\`)`,
              path: ['compareWith'],
            });
          }
        }
      },
    ),
  exitCode: (err, ctx) => {
    if (err instanceof HashMismatchSignal) return 1;
    const isCompareMode = ctx?.rawConfig?.compareWith !== undefined;
    return isCompareMode ? 2 : 1;
  },
  handler: async (config) => {
    configureLogger({
      verbose: config.verbose === true,
      quiet: config.quiet === true,
    });

    const isCompareMode = config.compareWith !== undefined;

    if (isCompareMode && config.out !== undefined) {
      throw new HashCompareError(
        '--out cannot be combined with --compare-with (compare-mode output is verdict-tied to the exit code)',
      );
    }

    const sourceSpecs =
      config.sources === undefined
        ? []
        : Array.isArray(config.sources)
          ? config.sources
          : [config.sources];

    if (isCompareMode) {
      if (sourceSpecs.length !== 1) {
        throw new HashCompareError(
          '--compare-with requires exactly one primary source',
        );
      }
    } else if (sourceSpecs.length === 0) {
      throw new Error('a sources glob is required');
    }

    const logger = new Logger('sparqly');
    const graphMode = config.graphMode as GraphMode | undefined;

    if (isCompareMode) {
      const compareSpec = config.compareWith as string;
      let primary: { source: string; hash: string };
      let secondary: { source: string; hash: string };
      try {
        primary = await hashSource(sourceSpecs[0], graphMode, logger);
        secondary = await hashSource(compareSpec, graphMode, logger);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new HashCompareError(message);
      }

      if (primary.hash === secondary.hash) {
        process.stdout.write(`match: ${primary.hash}\n`);
        return;
      }
      process.stdout.write(`${primary.hash}  ${primary.source}\n`);
      process.stdout.write(`${secondary.hash}  ${secondary.source}\n`);
      throw new HashMismatchSignal('hash mismatch');
    }

    const results: Array<{ source: string; hash: string }> = [];
    for (const spec of sourceSpecs) {
      results.push(await hashSource(spec, graphMode, logger));
    }

    const body = config.json
      ? `${JSON.stringify(results)}\n`
      : results.map(({ hash, source }) => `${hash}  ${source}\n`).join('');

    if (config.out !== undefined) {
      await writeOutputToFile({
        out: config.out,
        cwd: process.cwd(),
        body,
      });
    } else {
      process.stdout.write(body);
    }
  },
};

function rawEndpoint(entry: SourceSpecInput): string | null {
  let parsed;
  try {
    parsed = parseSourceSpec(entry);
  } catch {
    return null;
  }
  if (parsed.kind !== 'endpoint') return null;
  return parsed.endpoint;
}

async function hashSource(
  spec: string,
  graphMode: GraphMode | undefined,
  logger: Logger,
): Promise<{ source: string; hash: string }> {
  const start = Date.now();
  const { store, files, canonicalText } = await canonicalizeRdf({
    sources: spec,
    graphMode,
  });
  const hash = createHash('sha256').update(canonicalText).digest('hex');
  logger.log(
    `Loaded ${files.length} file(s) (${store.size} quads), canonicalized + hashed '${spec}' in ${Date.now() - start}ms`,
  );
  return { source: spec, hash };
}

export { HashMismatchSignal, HashCompareError };
