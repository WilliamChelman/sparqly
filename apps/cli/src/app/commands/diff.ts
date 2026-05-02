import { readFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import { Logger } from '@nestjs/common';
import { Parser } from 'n3';
import { z } from 'zod';
import {
  canonicalizeRdf,
  canonicalizeStore,
  diffCanonicalStatements,
  formatRdf,
  formatRdfDiff,
  parseSourceSpec,
  resolveAnonymousView,
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
  query?: string;
  queryFile?: string;
  leftQuery?: string;
  leftQueryFile?: string;
  rightQuery?: string;
  rightQueryFile?: string;
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

const queryField: FieldDescriptor = {
  key: 'query',
  schema: z.string().min(1),
  env: ['SPARQLY_DIFF_QUERY'],
  flags: [
    {
      spec: '--query <sparql>',
      description:
        'Inline SPARQL CONSTRUCT or SELECT-{?s,?p,?o[,?g]} that scopes BOTH sides identically. Required for SPARQL endpoint sources; otherwise optional. Lowers to an anonymous, uncached view per side. Mutually exclusive with --query-file. Requires exactly one source per side.',
    },
  ],
};

const queryFileField: FieldDescriptor = {
  key: 'queryFile',
  schema: z.string().min(1),
  env: ['SPARQLY_DIFF_QUERY_FILE'],
  flags: [
    {
      spec: '--query-file <path>',
      description:
        'Path to a SPARQL file (relative to CWD) used as the inline scoping query for both sides. Mutually exclusive with --query. Requires exactly one source per side.',
    },
  ],
};

const leftQueryField: FieldDescriptor = {
  key: 'leftQuery',
  schema: z.string().min(1),
  env: ['SPARQLY_DIFF_LEFT_QUERY'],
  flags: [
    {
      spec: '--left-query <sparql>',
      description:
        'Inline SPARQL CONSTRUCT or SELECT-{?s,?p,?o[,?g]} that scopes the LEFT side. Required for SPARQL endpoint sources on that side; otherwise optional. Lowers to an anonymous, uncached view. Mutually exclusive with --left-query-file and with the symmetric --query/--query-file.',
    },
  ],
};

const leftQueryFileField: FieldDescriptor = {
  key: 'leftQueryFile',
  schema: z.string().min(1),
  env: ['SPARQLY_DIFF_LEFT_QUERY_FILE'],
  flags: [
    {
      spec: '--left-query-file <path>',
      description:
        'Path to a SPARQL file (relative to CWD) used as the inline scoping query for the left side. Mutually exclusive with --left-query and with the symmetric --query/--query-file.',
    },
  ],
};

const rightQueryField: FieldDescriptor = {
  key: 'rightQuery',
  schema: z.string().min(1),
  env: ['SPARQLY_DIFF_RIGHT_QUERY'],
  flags: [
    {
      spec: '--right-query <sparql>',
      description:
        'Inline SPARQL CONSTRUCT or SELECT-{?s,?p,?o[,?g]} that scopes the RIGHT side. Required for SPARQL endpoint sources on that side; otherwise optional. Lowers to an anonymous, uncached view. Mutually exclusive with --right-query-file and with the symmetric --query/--query-file.',
    },
  ],
};

const rightQueryFileField: FieldDescriptor = {
  key: 'rightQueryFile',
  schema: z.string().min(1),
  env: ['SPARQLY_DIFF_RIGHT_QUERY_FILE'],
  flags: [
    {
      spec: '--right-query-file <path>',
      description:
        'Path to a SPARQL file (relative to CWD) used as the inline scoping query for the right side. Mutually exclusive with --right-query and with the symmetric --query/--query-file.',
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
    queryField,
    queryFileField,
    leftQueryField,
    leftQueryFileField,
    rightQueryField,
    rightQueryFileField,
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
        const hasSymQuery = typeof val.query === 'string';
        const hasSymQueryFile = typeof val.queryFile === 'string';
        if (hasSymQuery && hasSymQueryFile) {
          ctx.addIssue({
            code: 'custom',
            message:
              '`--query` and `--query-file` are mutually exclusive on `diff`',
            path: ['query'],
          });
        }
        const symInlineScope = hasSymQuery || hasSymQueryFile;

        for (const side of ['left', 'right'] as const) {
          const sideQueryKey = side === 'left' ? 'leftQuery' : 'rightQuery';
          const sideQueryFileKey =
            side === 'left' ? 'leftQueryFile' : 'rightQueryFile';
          const sideQueryFlag =
            side === 'left' ? '--left-query' : '--right-query';
          const sideQueryFileFlag =
            side === 'left' ? '--left-query-file' : '--right-query-file';
          const hasSideQuery = typeof val[sideQueryKey] === 'string';
          const hasSideQueryFile = typeof val[sideQueryFileKey] === 'string';

          if (hasSideQuery && hasSideQueryFile) {
            ctx.addIssue({
              code: 'custom',
              message: `\`${sideQueryFlag}\` and \`${sideQueryFileFlag}\` are mutually exclusive on \`diff\``,
              path: [sideQueryKey],
            });
          }
          if (symInlineScope && hasSideQuery) {
            ctx.addIssue({
              code: 'custom',
              message: `symmetric \`--query\`/\`--query-file\` and \`${sideQueryFlag}\` are mutually exclusive on the same side`,
              path: [sideQueryKey],
            });
          }
          if (symInlineScope && hasSideQueryFile) {
            ctx.addIssue({
              code: 'custom',
              message: `symmetric \`--query\`/\`--query-file\` and \`${sideQueryFileFlag}\` are mutually exclusive on the same side`,
              path: [sideQueryFileKey],
            });
          }

          const value = val[side];
          if (value === undefined) continue;
          const list: SourceSpecInput[] = Array.isArray(value)
            ? (value as SourceSpecInput[])
            : [value as SourceSpecInput];

          const sideHasInlineScope =
            symInlineScope || hasSideQuery || hasSideQueryFile;

          if (sideHasInlineScope && list.length > 1) {
            ctx.addIssue({
              code: 'custom',
              message: `\`--query\`/\`--query-file\` requires exactly one source per side (got ${list.length} on ${side}); express unions through a declared \`view\` source kind`,
              path: [side],
            });
            continue;
          }

          if (sideHasInlineScope) continue;

          list.forEach((entry, i) => {
            const violation = rawEndpoint(entry);
            if (violation) {
              ctx.addIssue({
                code: 'custom',
                message: `SPARQL endpoint ${violation} cannot be diffed directly on the ${side} side (diff always materializes; wrap the endpoint in a \`view\` source kind to scope it, pass \`--query\`/\`--query-file\` to scope it inline, or pipe \`sparqly query --format=turtle\` into \`sparqly diff\`)`,
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

    const symmetricInlineQuery = await loadSymmetricInlineScopeQuery(config);
    const [leftInlineQuery, rightInlineQuery] = await Promise.all([
      loadSideInlineScopeQuery(
        symmetricInlineQuery,
        config.leftQuery,
        config.leftQueryFile,
      ),
      loadSideInlineScopeQuery(
        symmetricInlineQuery,
        config.rightQuery,
        config.rightQueryFile,
      ),
    ]);

    const start = Date.now();
    const [leftResult, rightResult] = await Promise.all([
      canonicalizeSide(config.left, graphMode, leftInlineQuery),
      canonicalizeSide(config.right, graphMode, rightInlineQuery),
    ]);
    logger.log(
      `Loaded ${leftResult.fileCount} left + ${rightResult.fileCount} right file(s), canonicalized in ${Date.now() - start}ms`,
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

interface SideCanonicalResult {
  fileCount: number;
  canonicalStatements: string[];
  prefixes: Record<string, Record<string, string>>;
}

async function canonicalizeSide(
  source: string | string[],
  graphMode: GraphMode | undefined,
  inlineQuery: string | undefined,
): Promise<SideCanonicalResult> {
  if (inlineQuery !== undefined) {
    const spec = Array.isArray(source) ? source[0] : source;
    const store = await resolveAnonymousView({
      source: spec,
      query: inlineQuery,
    });
    const { canonicalStatements } = await canonicalizeStore(store);
    return { fileCount: 0, canonicalStatements, prefixes: {} };
  }
  const result = await canonicalizeRdf({ sources: source, graphMode });
  return {
    fileCount: result.files.length,
    canonicalStatements: result.canonicalStatements,
    prefixes: result.prefixes,
  };
}

async function loadSymmetricInlineScopeQuery(
  config: DiffConfig,
): Promise<string | undefined> {
  if (typeof config.query === 'string') return config.query;
  if (typeof config.queryFile === 'string') {
    const path = resolvePath(process.cwd(), config.queryFile);
    return readFile(path, 'utf8');
  }
  return undefined;
}

async function loadSideInlineScopeQuery(
  symmetric: string | undefined,
  sideQuery: string | undefined,
  sideQueryFile: string | undefined,
): Promise<string | undefined> {
  if (typeof sideQuery === 'string') return sideQuery;
  if (typeof sideQueryFile === 'string') {
    const path = resolvePath(process.cwd(), sideQueryFile);
    return readFile(path, 'utf8');
  }
  return symmetric;
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
