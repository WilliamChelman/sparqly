import { fileURLToPath } from 'node:url';
import { shortenNQuadLine, type SparqlyLogger } from 'common';
import {
  composeHtmlDiff,
  diffStores,
  formatDiffSummaryLine,
  formatHumanSourceComment,
  formatRdfDiff,
  groupRdfDiffByEntity,
  readSourceSnippet,
  type HtmlDiffSnippets,
  type Hunk,
  type ParsedSource,
  type RdfDiffResult,
  type SnippetReadResult,
  type SourceRecord,
} from 'core';
import { writeOutputToFile } from '../../output';
import { DiffPresentSignal, type DiffConfig } from './diff';
import { type DiffFormat } from './fields';
import { resolveSide } from './side';

interface RunGraphDiffArgs {
  config: DiffConfig;
  format: DiffFormat;
  quiet: boolean;
  logger: SparqlyLogger;
  leftTarget: ParsedSource;
  rightTarget: ParsedSource;
  leftInlineQuery: string | undefined;
  rightInlineQuery: string | undefined;
  registry?: ReadonlyArray<ParsedSource>;
}

export async function runGraphDiff(args: RunGraphDiffArgs): Promise<void> {
  const {
    config,
    format,
    quiet,
    logger,
    leftTarget,
    rightTarget,
    leftInlineQuery,
    rightInlineQuery,
    registry,
  } = args;

  const start = Date.now();
  const [leftResolved, rightResolved] = await Promise.all([
    resolveSide(leftTarget, config, leftInlineQuery, 'left', logger, registry),
    resolveSide(rightTarget, config, rightInlineQuery, 'right', logger, registry),
  ]);
  const diff = await diffStores(
    {
      store: leftResolved.store,
      annotationPredicates: leftResolved.annotationPredicates,
      sourceRecords: leftResolved.sourceRecords,
    },
    {
      store: rightResolved.store,
      annotationPredicates: rightResolved.annotationPredicates,
      sourceRecords: rightResolved.sourceRecords,
    },
  );
  logger.debug('source-loaded', {
    leftFiles: leftResolved.fileCount,
    rightFiles: rightResolved.fileCount,
    ms: Date.now() - start,
  });

  const sourcePrefixes: Record<string, Record<string, string>> = {
    ...leftResolved.prefixes,
    ...rightResolved.prefixes,
  };
  const resolvedPrefixes = resolveDiffPrefixes(
    config.prefixes ?? {},
    sourcePrefixes,
  );

  const cwd = process.cwd();
  const snippetContext = config.snippetContext ?? 3;
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
  const hunked =
    format === 'html' || format === 'grouped'
      ? groupRdfDiffByEntity({
          diff,
          left: { store: leftResolved.store },
          right: { store: rightResolved.store },
        })
      : undefined;
  const snippetsByRecord =
    format === 'html'
      ? await fetchSnippetsForHunkedDiff(
          hunked as ReturnType<typeof groupRdfDiffByEntity>,
          snippetContext,
        )
      : new Map<string, SnippetReadResult>();
  const body =
    format === 'html'
      ? composeHtmlDiff(
          hunked as ReturnType<typeof groupRdfDiffByEntity>,
          snippetsByRecord,
          { cwd, context: snippetContext, prefixes: resolvedPrefixes },
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
          : format === 'grouped'
            ? formatRdfDiff(diff, 'grouped', {
                prefixes: resolvedPrefixes,
                hunked: hunked as ReturnType<typeof groupRdfDiffByEntity>,
              })
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
        'note: no source records present; HTML output will contain no line numbers (per-quad provenance is only attached to glob/file targets — wrap views/endpoints in a glob)\n',
      );
    }
    if (leftResolved.annotated !== rightResolved.annotated) {
      const annotatedSide = leftResolved.annotated ? 'left' : 'right';
      const otherSide = leftResolved.annotated ? 'right' : 'left';
      process.stderr.write(
        `note: source records present on ${annotatedSide} only — ${otherSide} side hunks will not be annotated\n`,
      );
    }
    process.stderr.write(
      `# ${formatDiffSummaryLine(diff.totals, added.length, removed.length)}\n`,
    );
  }

  if (added.length !== 0 || removed.length !== 0) {
    throw new DiffPresentSignal();
  }
}

/**
 * Compute the unique set of (file, line) snippet reads needed to render
 * the html diff. Walks the per-hunk source records gathered by
 * `groupRdfDiffByEntity` — both the changed-line records and the
 * anchor-definition-site records that back `defined here` snippets — all of
 * which are scoped, so this naturally avoids the auto-annotated full-file walk.
 */
export function collectSnippetKeysForHunkedDiff(
  hunked: { hunks: readonly Hunk[] },
): Map<string, { file: string; startLine: number; endLine: number }> {
  const seen = new Map<string, { file: string; startLine: number; endLine: number }>();
  const collect = (records: readonly SourceRecord[]): void => {
    for (const r of records) {
      if (r.line === undefined) continue;
      const startLine = r.line;
      const endLine = r.endLine ?? r.line;
      const key =
        startLine === endLine
          ? `${r.file}:${startLine}`
          : `${r.file}:${startLine}-${endLine}`;
      if (!seen.has(key)) seen.set(key, { file: r.file, startLine, endLine });
    }
  };
  for (const h of hunked.hunks) {
    collect(h.sourceRecords.left);
    collect(h.sourceRecords.right);
    if (h.anchorSource !== undefined) {
      collect(h.anchorSource.left);
      collect(h.anchorSource.right);
    }
  }
  return seen;
}

async function fetchSnippetsForHunkedDiff(
  hunked: { hunks: readonly Hunk[] },
  context: number,
): Promise<HtmlDiffSnippets> {
  const seen = collectSnippetKeysForHunkedDiff(hunked);
  const entries = await Promise.all(
    [...seen.entries()].map(async ([key, { file, startLine, endLine }]) => {
      const abs = fileURLToPath(file);
      return [key, await readSourceSnippet(abs, startLine, endLine, context)] as const;
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
  const parts: string[] = [
    `# ${formatDiffSummaryLine(diff.totals, diff.added.length, diff.removed.length)}\n`,
  ];
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
