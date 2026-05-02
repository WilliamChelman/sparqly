import { Logger } from '@nestjs/common';
import { Parser } from 'n3';
import { z } from 'zod';
import {
  canonicalizeRdf,
  diffCanonicalStatements,
  formatRdf,
  formatRdfDiff,
  parseSourceSpec,
  shortenNQuadLine,
  type FormatSerialization,
  type GraphMode,
  type RdfDiffResult,
  type SourceSpecInput,
} from 'core';
import { configureLogger } from '../logging';
import { writeOutputToFile } from '../output';
import type { FieldDescriptor } from '../runner/field';
import {
  baseField,
  graphModeFieldFor,
  outFieldFor,
  prefixesField,
  verbosityFieldsFor,
} from '../runner/fields-shared';
import type { CommandSpec } from '../runner/spec';

const DIFF_FORMATS = ['human', 'json', 'rdf-patch', 'turtle'] as const;
type DiffFormat = (typeof DIFF_FORMATS)[number];

interface DiffConfig {
  left?: string;
  right?: string;
  graphMode?: GraphMode;
  format?: DiffFormat;
  prefixes?: Record<string, string>;
  base?: string;
  out?: string;
  verbose?: boolean;
  quiet?: boolean;
}

class DiffPresentSignal extends Error {
  readonly silent = true;
  constructor() {
    super('diff present');
    this.name = 'DiffPresentSignal';
  }
}

const leftField: FieldDescriptor = {
  key: 'left',
  schema: z.union([z.string(), z.array(z.string()).min(1)]),
  env: ['SPARQLY_DIFF_LEFT'],
  flags: [
    {
      spec: '--left <source>',
      description:
        'Left-hand source spec (file path or glob). Alternative to the first positional argument.',
    },
  ],
};

const rightField: FieldDescriptor = {
  key: 'right',
  schema: z.union([z.string(), z.array(z.string()).min(1)]),
  env: ['SPARQLY_DIFF_RIGHT'],
  flags: [
    {
      spec: '--right <source>',
      description:
        'Right-hand source spec (file path or glob). Alternative to the second positional argument.',
    },
  ],
};

const formatField: FieldDescriptor = {
  key: 'format',
  schema: z.enum(DIFF_FORMATS),
  default: 'human',
  env: ['SPARQLY_DIFF_FORMAT'],
  flags: [
    {
      spec: '-f, --format <format>',
      description: `Output format: ${DIFF_FORMATS.map((f) => `'${f}'`).join(', ')}.`,
    },
  ],
};

export const diffSpec: CommandSpec<DiffConfig> = {
  name: 'diff',
  description:
    'Compute a semantic diff between two RDF sources via RDFC-1.0 canonicalization. Always materializes both sides; a SPARQL endpoint source is rejected on either side (wrap it in a `view` source kind to scope it). Determinism caveat: a remote endpoint can return different data between runs, so a SPARQL diff is only as deterministic as the endpoint. Note: RDFC-1.0 does not normalize literal lexical forms.',
  fields: [
    leftField,
    rightField,
    graphModeFieldFor('diff'),
    formatField,
    prefixesField,
    baseField,
    outFieldFor('diff'),
    ...verbosityFieldsFor('diff'),
  ],
  positionals: [
    { field: 'left', name: 'left' },
    { field: 'right', name: 'right' },
  ],
  refine: (schema) =>
    (schema as z.ZodObject).superRefine(
      (val: Record<string, unknown>, ctx) => {
        for (const side of ['left', 'right'] as const) {
          const value = val[side];
          if (value === undefined) continue;
          const list: SourceSpecInput[] = Array.isArray(value)
            ? (value as SourceSpecInput[])
            : [value as SourceSpecInput];
          list.forEach((entry, i) => {
            const violation = rawEndpoint(entry);
            if (violation) {
              ctx.addIssue({
                code: 'custom',
                message: `SPARQL endpoint ${violation} cannot be diffed directly on the ${side} side (diff always materializes; wrap the endpoint in a \`view\` source kind to scope it, or pipe \`sparqly query --format=turtle\` into \`sparqly diff\`)`,
                path: Array.isArray(value) ? [side, i] : [side],
              });
            }
          });
        }
      },
    ),
  exitCode: (err) => {
    if (err instanceof DiffPresentSignal) return 1;
    return 2;
  },
  handler: async (config) => {
    configureLogger({
      verbose: config.verbose === true,
      quiet: config.quiet === true,
    });

    if (config.left === undefined || config.right === undefined) {
      throw new Error('diff requires two source specs (left and right)');
    }

    const logger = new Logger('sparqly');
    const graphMode = config.graphMode;
    const format = (config.format ?? 'human') as DiffFormat;
    const quiet = config.quiet === true;

    const start = Date.now();
    const [leftResult, rightResult] = await Promise.all([
      canonicalizeRdf({ sources: config.left, graphMode }),
      canonicalizeRdf({ sources: config.right, graphMode }),
    ]);
    logger.log(
      `Loaded ${leftResult.files.length} left + ${rightResult.files.length} right file(s), canonicalized in ${Date.now() - start}ms`,
    );

    const diff = diffCanonicalStatements(
      leftResult.canonicalStatements,
      rightResult.canonicalStatements,
    );
    const sourcePrefixes: Record<string, Record<string, string>> = {
      ...leftResult.prefixes,
      ...rightResult.prefixes,
    };
    const resolvedPrefixes = resolveDiffPrefixes(
      config.prefixes ?? {},
      sourcePrefixes,
    );

    const body =
      format === 'turtle'
        ? renderTurtleBlocks(diff, resolvedPrefixes)
        : format === 'human'
          ? renderHumanShortened(diff, resolvedPrefixes)
          : formatRdfDiff(diff, format);
    const { added, removed } = diff;

    if (config.out !== undefined) {
      await writeOutputToFile({
        out: config.out,
        cwd: process.cwd(),
        body,
      });
    } else {
      process.stdout.write(body);
    }

    if (!quiet) {
      process.stderr.write(`# +${added.length} -${removed.length}\n`);
    }

    if (added.length !== 0 || removed.length !== 0) {
      throw new DiffPresentSignal();
    }
  },
};

function resolveDiffPrefixes(
  configPrefixes: Record<string, string>,
  sourcePrefixes: Record<string, Record<string, string>>,
): Record<string, string> {
  const merged: Record<string, string> = { ...configPrefixes };
  for (const file of Object.keys(sourcePrefixes)) {
    for (const [name, iri] of Object.entries(sourcePrefixes[file])) {
      merged[name] = iri;
    }
  }
  return merged;
}

function renderHumanShortened(
  diff: RdfDiffResult,
  prefixes: Record<string, string>,
): string {
  const parts: string[] = [];
  for (const s of diff.removed)
    parts.push(`- ${shortenNQuadLine(s, { prefixes })}\n`);
  for (const s of diff.added)
    parts.push(`+ ${shortenNQuadLine(s, { prefixes })}\n`);
  return parts.join('');
}

function renderTurtleBlocks(
  diff: RdfDiffResult,
  prefixes: Record<string, string>,
): string {
  return (
    `# --- removed ---\n${formatBlock(diff.removed, prefixes)}` +
    `# --- added ---\n${formatBlock(diff.added, prefixes)}`
  );
}

function formatBlock(
  statements: ReadonlyArray<string>,
  prefixes: Record<string, string>,
): string {
  if (statements.length === 0) return '';
  const parser = new Parser({ format: 'application/n-quads' });
  const quads = parser.parse(statements.join('\n'));
  const serialization: FormatSerialization = quads.some(
    (q) => q.graph.termType === 'NamedNode',
  )
    ? 'trig'
    : 'turtle';
  const out = formatRdf(quads, serialization, { prefixes });
  return out.endsWith('\n') ? out : `${out}\n`;
}

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

export { DiffPresentSignal, DIFF_FORMATS };
