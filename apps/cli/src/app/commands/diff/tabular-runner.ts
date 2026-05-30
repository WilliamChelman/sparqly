import type { SparqlyLogger } from 'common';
import {
  detectSelectShape,
  formatDiffSummaryLine,
  formatTabularDiff,
  resolveInlineSelectBindings,
  tabularDiff,
  type ParsedSource,
  type SelectShapeReport,
} from 'core';
import { writeOutputToFile } from '../../output';
import { DiffErrorSignal } from '../diff-error';
import { DiffPresentSignal, type DiffConfig } from './diff';
import { type DiffFormat } from './fields';
import { inlineQueryUpstream } from './side';

/** Throws when one side is triples-shape and the other tuples-shape — neither dispatch path can compare them. */
export function detectTabularDispatch(
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
    throw new DiffErrorSignal({
      kind: 'mixed-shape',
      triplesSide,
      tuplesSide,
    });
  }
  return { left, right };
}

interface RunTabularDiffArgs {
  config: DiffConfig;
  format: DiffFormat;
  quiet: boolean;
  logger: SparqlyLogger;
  leftTarget: ParsedSource;
  rightTarget: ParsedSource;
  leftInlineQuery: string;
  rightInlineQuery: string;
  leftShape: SelectShapeReport;
  rightShape: SelectShapeReport;
}

export async function runTabularDiff(args: RunTabularDiffArgs): Promise<void> {
  const {
    config,
    format,
    quiet,
    logger,
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
    throw new DiffErrorSignal({
      kind: 'set-mismatch',
      left: [...leftSet],
      right: [...rightSet],
    });
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

  const leftUpstream = inlineQueryUpstream(leftTarget, 'left');
  const rightUpstream = inlineQueryUpstream(rightTarget, 'right');

  const [left, right] = await Promise.all([
    resolveInlineSelectBindings({
      source: leftUpstream,
      query: leftInlineQuery,
      logger,
    }),
    resolveInlineSelectBindings({
      source: rightUpstream,
      query: rightInlineQuery,
      logger,
    }),
  ]);

  const tabResult = tabularDiff(left.rows, right.rows, [
    ...rightShape.variables,
  ]);
  if (tabResult.isErr()) {
    throw new DiffErrorSignal(tabResult.error);
  }
  const tab = tabResult.value;
  const body = formatTabularDiff(tab, format, {
    variables: rightShape.variables,
  });

  if (config.out !== undefined) {
    await writeOutputToFile({ out: config.out, cwd: process.cwd(), body });
  } else {
    process.stdout.write(body);
  }

  if (!quiet) {
    process.stderr.write(
      `# ${formatDiffSummaryLine(tab.totals, tab.added.length, tab.removed.length)}\n`,
    );
  }

  if (tab.added.length !== 0 || tab.removed.length !== 0) {
    throw new DiffPresentSignal();
  }
}
