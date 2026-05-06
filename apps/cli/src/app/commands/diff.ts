import { readFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Logger } from '@nestjs/common';
import { type Store } from 'n3';
import { z } from 'zod';
import {
  ANNOTATE_SOURCE_TRANSFORM,
  composeHtmlDiff,
  detectSelectShape,
  diffStores,
  extractAnnotationPredicates,
  formatHumanSourceComment,
  formatRdfDiff,
  formatTabularDiff,
  hasAnnotateTransform,
  parseSourceSpecs,
  readSourceSnippet,
  resolveAnonymousSelectBindings,
  resolveAnonymousView,
  resolveSource,
  selectTarget,
  shortenNQuadLine,
  tabularDiff,
  type AnnotationPredicateIris,
  type GraphMode,
  type HtmlDiffSnippets,
  type ParsedSource,
  type ParsedTransform,
  type RdfDiffResult,
  type SelectShapeReport,
  type SnippetReadResult,
  type SourceRecord,
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
  singleSourceSchema,
  verbosityFieldsFor,
} from '../runner/fields-shared';
import type { CommandSpec } from '../runner/spec';

const DIFF_FORMATS = ['html', 'human', 'json', 'rdf-patch', 'turtle'] as const;
type DiffFormat = (typeof DIFF_FORMATS)[number];

const MAX_CONTEXT = 100;

interface DiffConfig {
  sources?: SourceSpecInput[];
  left?: SourceSpecInput;
  right?: SourceSpecInput;
  graphMode?: GraphMode;
  format?: DiffFormat;
  prefixes?: Record<string, string>;
  base?: string;
  out?: string;
  context?: number;
  query?: string;
  queryFile?: string;
  leftQuery?: string;
  leftQueryFile?: string;
  rightQuery?: string;
  rightQueryFile?: string;
  skipAutoSourceAnnotation?: boolean;
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

const sourceSpecObjectSchema = z.record(z.string(), z.unknown());

const sourcesRegistryField: FieldDescriptor = {
  key: 'sources',
  schema: z.array(z.union([z.string(), sourceSpecObjectSchema])),
};

const leftField: FieldDescriptor = {
  key: 'left',
  schema: singleSourceSchema,
  env: ['SPARQLY_DIFF_LEFT'],
  flags: [
    {
      spec: '--left <source>',
      description:
        'Left-hand target source: an `@id` ref into the config registry, or an inline glob/URL. Alternative to the first positional argument.',
    },
  ],
};

const rightField: FieldDescriptor = {
  key: 'right',
  schema: singleSourceSchema,
  env: ['SPARQLY_DIFF_RIGHT'],
  flags: [
    {
      spec: '--right <source>',
      description:
        'Right-hand target source: an `@id` ref into the config registry, or an inline glob/URL. Alternative to the second positional argument.',
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
        'Inline SPARQL CONSTRUCT or SELECT-{?s,?p,?o[,?g]} that scopes BOTH sides identically. Required for SPARQL endpoint targets; otherwise optional. Lowers to an anonymous, uncached view per side. Mutually exclusive with --query-file.',
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
        'Path to a SPARQL file (relative to CWD) used as the inline scoping query for both sides. Mutually exclusive with --query.',
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
        'Inline SPARQL CONSTRUCT or SELECT-{?s,?p,?o[,?g]} that scopes the LEFT side. Required for SPARQL endpoint targets on that side; otherwise optional. Lowers to an anonymous, uncached view. Mutually exclusive with --left-query-file and with the symmetric --query/--query-file.',
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
        'Inline SPARQL CONSTRUCT or SELECT-{?s,?p,?o[,?g]} that scopes the RIGHT side. Required for SPARQL endpoint targets on that side; otherwise optional. Lowers to an anonymous, uncached view. Mutually exclusive with --right-query-file and with the symmetric --query/--query-file.',
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
      description: `Output format: ${DIFF_FORMATS.map((f) => `'${f}'`).join(', ')}. Format \`html\` benefits from source records, which \`diff\` auto-attaches to glob targets unless \`--skip-auto-source-annotation\` is passed.`,
    },
  ],
};

const skipAutoSourceAnnotationField: FieldDescriptor = {
  key: 'skipAutoSourceAnnotation',
  schema: z.preprocess(
    (v) => (typeof v === 'string' ? v === 'true' : v),
    z.boolean(),
  ),
  default: false,
  env: ['SPARQLY_DIFF_SKIP_AUTO_SOURCE_ANNOTATION'],
  flags: [
    {
      spec: '--skip-auto-source-annotation',
      description:
        "Suppress `diff`'s implicit `annotateSource` injection on glob targets. Has no effect on view/endpoint targets (which can't carry source records anyway). An explicit `annotateSource` declared in config still runs. Also a no-op in tabular diff mode — bindings rows have no per-row provenance, so no annotation is injected on either side.",
    },
  ],
};

const contextField: FieldDescriptor = {
  key: 'context',
  schema: z.preprocess((v) => {
    if (typeof v === 'string' && v.trim() !== '') {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
    return v;
  }, z.number().int().min(0).max(MAX_CONTEXT)),
  env: ['SPARQLY_DIFF_CONTEXT'],
  flags: [
    {
      spec: '-C, --context <n>',
      description: `Number of source-file context lines around each focal line in the \`html\` format (default 3, max ${MAX_CONTEXT}). Loud-errors when used with any non-html format.`,
    },
  ],
};

/**
 * Implement the ADR-0008 carve-out: `diff` prepends `annotateSource` to a
 * glob target's transform pipeline so HTML/turtle/json output gets line
 * numbers without ceremony. Skipped if the user passed
 * `--skip-auto-source-annotation`, if the target isn't a glob (views and
 * endpoints can't carry source records anyway), or if an explicit
 * `annotateSource` is already declared (explicit predicates win).
 */
export function withAutoSourceAnnotation(
  target: ParsedSource,
  opts: { skipAuto: boolean },
): ParsedSource {
  if (opts.skipAuto) return target;
  if (target.kind !== 'glob') return target;
  const declared = target.transforms ?? [];
  if (declared.some((t) => t.key === 'annotateSource')) return target;
  const parsed = ANNOTATE_SOURCE_TRANSFORM.parse({});
  const implicit: ParsedTransform =
    typeof parsed === 'function'
      ? { key: 'annotateSource', apply: parsed }
      : { key: 'annotateSource', apply: parsed.apply, config: parsed.config };
  return { ...target, transforms: [implicit, ...declared] };
}

export function resolveDiffSide(
  config: DiffConfig,
  side: 'left' | 'right',
): ParsedSource {
  const registry = parseSourceSpecs(config.sources ?? []);
  const value = config[side];
  const targetArg = typeof value === 'string' ? value : undefined;
  if (value !== undefined && targetArg === undefined) {
    return parseSourceSpecs([value])[0];
  }
  return selectTarget(registry, targetArg);
}

export const diffSpec: CommandSpec<DiffConfig> = {
  name: 'diff',
  description:
    'Compute a semantic diff between two target sources via RDFC-1.0 canonicalization. Each side accepts an `@id` ref into the config registry or an inline glob/URL. Materializes the *result* on both sides; for endpoint-backed views the query passes through to the endpoint. Glob targets are auto-annotated with source records by default, so HTML and other formats surface line numbers without ceremony — opt out via `--skip-auto-source-annotation`. A SPARQL endpoint target is rejected as a raw input on either side (wrap it in a `view` source kind to scope it, or pass `--query`/`--query-file`/`--left-query`/`--right-query`). Determinism caveat: a remote endpoint can return different data between runs, so a SPARQL diff is only as deterministic as the endpoint. Note: RDFC-1.0 does not normalize literal lexical forms.',
  fields: [
    leftField,
    rightField,
    sourcesRegistryField,
    graphModeFieldFor('diff'),
    queryField,
    queryFileField,
    leftQueryField,
    leftQueryFileField,
    rightQueryField,
    rightQueryFileField,
    formatField,
    contextField,
    skipAutoSourceAnnotationField,
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
        if (val.context !== undefined && val.format !== 'html') {
          ctx.addIssue({
            code: 'custom',
            message:
              '`--context` is only valid with `--format=html`; remove `--context` or pass `--format=html`',
            path: ['context'],
          });
        }
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

    const leftTarget = resolveDiffSide(config, 'left');
    const rightTarget = resolveDiffSide(config, 'right');

    const tabularDispatch = detectTabularDispatch(
      leftInlineQuery,
      rightInlineQuery,
    );
    if (tabularDispatch) {
      await runTabularDiff({
        config,
        format,
        quiet,
        leftTarget,
        rightTarget,
        leftInlineQuery: leftInlineQuery as string,
        rightInlineQuery: rightInlineQuery as string,
        leftShape: tabularDispatch.left,
        rightShape: tabularDispatch.right,
      });
      return;
    }

    const start = Date.now();
    const [leftResolved, rightResolved] = await Promise.all([
      resolveSide(leftTarget, config, graphMode, leftInlineQuery, 'left'),
      resolveSide(rightTarget, config, graphMode, rightInlineQuery, 'right'),
    ]);
    const diff = await diffStores(
      { store: leftResolved.store, annotationPredicates: leftResolved.annotationPredicates },
      { store: rightResolved.store, annotationPredicates: rightResolved.annotationPredicates },
    );
    logger.log(
      `Loaded ${leftResolved.fileCount} left + ${rightResolved.fileCount} right file(s), canonicalized in ${Date.now() - start}ms`,
    );

    const sourcePrefixes: Record<string, Record<string, string>> = {
      ...leftResolved.prefixes,
      ...rightResolved.prefixes,
    };
    const resolvedPrefixes = resolveDiffPrefixes(
      config.prefixes ?? {},
      sourcePrefixes,
    );

    const cwd = process.cwd();
    const context = config.context ?? 3;
    // Test-only synchronization hook: emits a stable stderr marker and
    // pauses for N ms so an e2e parent can mutate the filesystem between
    // load and snippet fetching, making the load→snippet boundary
    // deterministically observable from a black-box CLI test. The marker
    // is emitted directly (not through the Nest logger) so it survives
    // --quiet and the default log-level filter. See
    // `apps/cli-e2e/.../diff-format-html`.
    const pauseMs = Number(
      process.env['SPARQLY_DEBUG_PAUSE_BEFORE_SNIPPETS_MS'] ?? '',
    );
    if (Number.isFinite(pauseMs) && pauseMs > 0) {
      process.stderr.write('sparqly-debug: pausing before snippets\n');
      await new Promise<void>((r) => setTimeout(r, pauseMs));
    }
    const snippetsByRecord =
      format === 'html'
        ? await fetchSnippetsForDiff(diff, diff.sourceRecords, context)
        : new Map<string, SnippetReadResult>();
    const body =
      format === 'html'
        ? composeHtmlDiff(
            diff,
            diff.sourceRecords,
            snippetsByRecord,
            { cwd, context },
          )
        : format === 'turtle'
          ? formatRdfDiff(diff, 'turtle', {
              cwd,
              prefixes: resolvedPrefixes,
              sourceRecords: diff.sourceRecords,
            })
          : format === 'human'
            ? renderHumanShortened(
                diff,
                resolvedPrefixes,
                diff.sourceRecords,
                cwd,
              )
            : formatRdfDiff(diff, format, {
                cwd,
                sourceRecords: diff.sourceRecords,
              });
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
      if (
        format === 'html' &&
        diff.sourceRecords.left.size === 0 &&
        diff.sourceRecords.right.size === 0
      ) {
        process.stderr.write(
          'note: no source records present; HTML output will contain no line numbers (auto source annotation only applies to glob targets — wrap views/endpoints in a glob, or remove --skip-auto-source-annotation)\n',
        );
      }
      if (leftResolved.annotated !== rightResolved.annotated) {
        const annotatedSide = leftResolved.annotated ? 'left' : 'right';
        const otherSide = leftResolved.annotated ? 'right' : 'left';
        process.stderr.write(
          `note: source records present on ${annotatedSide} only — ${otherSide} side hunks will not be annotated\n`,
        );
      }
      process.stderr.write(`# +${added.length} -${removed.length}\n`);
    }

    if (added.length !== 0 || removed.length !== 0) {
      throw new DiffPresentSignal();
    }
  },
};

/**
 * Compute the unique set of (file, line) snippet reads needed to render
 * the html diff. Scoped to records bucketed under a canonical statement
 * present in `diff.added` (right side) or `diff.removed` (left side) —
 * iterating the full per-side records map would (with auto-injected
 * `annotateSource`) walk every triple in both files, exploding into
 * tens of thousands of redundant `createReadStream` calls on large
 * inputs. Exported so the scope contract is unit-testable.
 */
export function collectSnippetKeysForDiff(
  diff: { added: readonly string[]; removed: readonly string[] },
  sourceRecords: {
    left: Map<string, SourceRecord[]>;
    right: Map<string, SourceRecord[]>;
  },
): Map<string, { file: string; line: number }> {
  const seen = new Map<string, { file: string; line: number }>();
  const collect = (records: readonly SourceRecord[] | undefined): void => {
    if (records === undefined) return;
    for (const r of records) {
      if (r.line === undefined) continue;
      const key = `${r.file}:${r.line}`;
      if (!seen.has(key)) seen.set(key, { file: r.file, line: r.line });
    }
  };
  for (const s of diff.removed) collect(sourceRecords.left.get(s));
  for (const s of diff.added) collect(sourceRecords.right.get(s));
  return seen;
}

async function fetchSnippetsForDiff(
  diff: RdfDiffResult,
  sourceRecords: {
    left: Map<string, SourceRecord[]>;
    right: Map<string, SourceRecord[]>;
  },
  context: number,
): Promise<HtmlDiffSnippets> {
  const seen = collectSnippetKeysForDiff(diff, sourceRecords);
  const entries = await Promise.all(
    [...seen.entries()].map(async ([key, { file, line }]) => {
      const abs = fileURLToPath(file);
      return [key, await readSourceSnippet(abs, line, context)] as const;
    }),
  );
  return new Map<string, SnippetReadResult>(entries);
}

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
  sourceRecords: {
    left: Map<string, SourceRecord[]>;
    right: Map<string, SourceRecord[]>;
  },
  cwd: string,
): string {
  const parts: string[] = [];
  for (const s of diff.removed) {
    const tail = formatHumanSourceComment(sourceRecords.left.get(s) ?? [], cwd);
    parts.push(`- ${shortenNQuadLine(s, { prefixes })}${tail}\n`);
  }
  for (const s of diff.added) {
    const tail = formatHumanSourceComment(sourceRecords.right.get(s) ?? [], cwd);
    parts.push(`+ ${shortenNQuadLine(s, { prefixes })}${tail}\n`);
  }
  return parts.join('');
}

interface SideResolved {
  fileCount: number;
  store: Store;
  prefixes: Record<string, Record<string, string>>;
  annotationPredicates: AnnotationPredicateIris;
  annotated: boolean;
}

function targetLabel(target: ParsedSource): string {
  if (target.id !== undefined) return `@${target.id}`;
  if (target.kind === 'glob') return target.glob;
  if (target.kind === 'endpoint') return target.endpoint;
  return `<${target.kind}>`;
}

function anonymousUpstream(
  target: ParsedSource,
  side: 'left' | 'right',
): SourceSpecInput {
  if (target.kind === 'glob') return target.glob;
  if (target.kind === 'endpoint') return target.endpoint;
  throw new Error(
    `--query/--query-file/--${side}-query scope a glob or SPARQL endpoint upstream; ${side} target ${targetLabel(target)} is a ${target.kind} source — drop the inline scope (it already has a query) or point at a glob/endpoint`,
  );
}

async function resolveSide(
  rawTarget: ParsedSource,
  config: DiffConfig,
  graphMode: GraphMode | undefined,
  inlineQuery: string | undefined,
  side: 'left' | 'right',
): Promise<SideResolved> {
  const target = withAutoSourceAnnotation(rawTarget, {
    skipAuto: config.skipAutoSourceAnnotation === true,
  });
  if (inlineQuery !== undefined) {
    const upstream = anonymousUpstream(target, side);
    const store = await resolveAnonymousView({
      source: upstream,
      query: inlineQuery,
    });
    return {
      fileCount: 0,
      store,
      prefixes: {},
      annotationPredicates: extractAnnotationPredicates(undefined),
      annotated: false,
    };
  }

  if (target.kind === 'endpoint') {
    throw new Error(
      `SPARQL endpoint ${target.endpoint} cannot be diffed directly on the ${side} side (diff materializes the result, but a raw endpoint has no scoping query; wrap the endpoint in a \`view\` source kind to scope it, pass \`--query\`/\`--query-file\` to scope it inline, or pipe \`sparqly query --format=turtle\` into \`sparqly diff\`)`,
    );
  }

  const registry = parseSourceSpecs(config.sources ?? []);
  const sources = await resolveSource(target, { graphMode, registry });
  if (sources.mode === 'pass-through') {
    throw new Error(
      `SPARQL endpoint ${sources.endpoint.endpoint} cannot be diffed directly on the ${side} side (diff materializes the result, but a raw endpoint has no scoping query; wrap the endpoint in a \`view\` source kind to scope it, pass \`--query\`/\`--query-file\` to scope it inline, or pipe \`sparqly query --format=turtle\` into \`sparqly diff\`)`,
    );
  }
  const transforms = target.kind === 'glob' ? target.transforms : undefined;
  return {
    fileCount: sources.files.length,
    store: sources.store,
    prefixes: sources.prefixes,
    annotationPredicates: extractAnnotationPredicates(transforms),
    annotated: hasAnnotateTransform(transforms),
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

/**
 * Returns the per-side `SelectShapeReport`s when both inline queries project
 * arbitrary tuples — the trigger for tabular dispatch. Returns `undefined`
 * when either inline query is missing, when both sides are triples-shape
 * (graph-diff path owns it), or when either side fails to parse (the
 * existing graph-diff path will surface a clearer error in those cases).
 *
 * Throws when one side is triples-shape and the other is tuples-shape —
 * neither dispatch path can sensibly compare tuples against triples.
 */
function detectTabularDispatch(
  leftInlineQuery: string | undefined,
  rightInlineQuery: string | undefined,
): { left: SelectShapeReport; right: SelectShapeReport } | undefined {
  if (leftInlineQuery === undefined || rightInlineQuery === undefined) {
    return undefined;
  }
  let left: SelectShapeReport;
  let right: SelectShapeReport;
  try {
    left = detectSelectShape(leftInlineQuery);
    right = detectSelectShape(rightInlineQuery);
  } catch {
    return undefined;
  }
  if (left.shape === 'triples' && right.shape === 'triples') return undefined;
  if (left.shape !== right.shape) {
    const tuplesSide = left.shape === 'tuples' ? 'left' : 'right';
    const triplesSide = tuplesSide === 'left' ? 'right' : 'left';
    throw new Error(
      `mixed-shape diff: ${triplesSide}-side query is triples-shape (CONSTRUCT or SELECT-{?s,?p,?o[,?g]}) while ${tuplesSide}-side query is tuples-shape (arbitrary SELECT). Either project triples on both sides (graph diff) or arbitrary tuples on both sides (tabular diff) — pick one shape and align both queries.`,
    );
  }
  return { left, right };
}

interface RunTabularDiffArgs {
  config: DiffConfig;
  format: DiffFormat;
  quiet: boolean;
  leftTarget: ParsedSource;
  rightTarget: ParsedSource;
  leftInlineQuery: string;
  rightInlineQuery: string;
  leftShape: SelectShapeReport;
  rightShape: SelectShapeReport;
}

async function runTabularDiff(args: RunTabularDiffArgs): Promise<void> {
  const {
    config,
    format,
    quiet,
    leftTarget,
    rightTarget,
    leftInlineQuery,
    rightInlineQuery,
    leftShape,
    rightShape,
  } = args;

  if (format !== 'human' && format !== 'json' && format !== 'html') {
    throw new Error(
      `--format=${format} does not apply to tuple results: ${format} is RDF-shaped and tabular diff returns SELECT bindings, not triples. Use --format=human, --format=json, or --format=html, or align both --left-query/--right-query as CONSTRUCT or SELECT-{?s,?p,?o[,?g]} to run a graph diff that ${format} can render.`,
    );
  }

  const leftSet = new Set(leftShape.variables);
  const rightSet = new Set(rightShape.variables);
  const setsMatch =
    leftSet.size === rightSet.size &&
    [...leftSet].every((v) => rightSet.has(v));
  if (!setsMatch) {
    const fmt = (s: ReadonlySet<string>): string =>
      `{${[...s].sort().map((v) => `?${v}`).join(', ')}}`;
    throw new Error(
      `tabular diff requires matching projected variable-name sets: left=${fmt(
        leftSet,
      )}, right=${fmt(rightSet)}`,
    );
  }

  if (leftShape.warnLimitOffsetWithoutOrderBy) {
    process.stderr.write(
      'note: left-side query uses LIMIT/OFFSET without ORDER BY — results may be non-deterministic\n',
    );
  }
  if (rightShape.warnLimitOffsetWithoutOrderBy) {
    process.stderr.write(
      'note: right-side query uses LIMIT/OFFSET without ORDER BY — results may be non-deterministic\n',
    );
  }

  const leftUpstream = anonymousUpstream(leftTarget, 'left');
  const rightUpstream = anonymousUpstream(rightTarget, 'right');
  const sourcesRegistry: SourceSpecInput[] = config.sources ?? [];

  const [left, right] = await Promise.all([
    resolveAnonymousSelectBindings({
      source: leftUpstream,
      query: leftInlineQuery,
      registry: sourcesRegistry,
    }),
    resolveAnonymousSelectBindings({
      source: rightUpstream,
      query: rightInlineQuery,
      registry: sourcesRegistry,
    }),
  ]);

  const tab = tabularDiff(left.rows, right.rows, [...rightShape.variables]);
  const body = formatTabularDiff(tab, format, {
    variables: rightShape.variables,
  });

  if (config.out !== undefined) {
    await writeOutputToFile({ out: config.out, cwd: process.cwd(), body });
  } else {
    process.stdout.write(body);
  }

  if (!quiet) {
    process.stderr.write(`# +${tab.added.length} -${tab.removed.length}\n`);
  }

  if (tab.added.length !== 0 || tab.removed.length !== 0) {
    throw new DiffPresentSignal();
  }
}

export { DiffPresentSignal, DIFF_FORMATS, detectTabularDispatch };
