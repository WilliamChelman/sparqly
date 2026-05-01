import { Logger } from '@nestjs/common';
import { Command, CommandRunner, Option } from 'nest-commander';
import { Parser } from 'n3';
import {
  canonicalizeRdf,
  diffCanonicalStatements,
  formatRdf,
  formatRdfDiff,
  shortenNQuadLine,
  type FormatSerialization,
  type GraphStrategy,
  type RdfDiffResult,
} from 'core';
import { runWithConfig, type EffectiveOptions } from './config';
import { DIFF_FORMATS, type DiffFormat } from './config/internal/schema';
import { exitCodeFor, isAdapterFailure } from './cli-errors';
import { diffAdapter, type DiffRawOptions } from './diff.adapter';
import { writeOutputToFile } from './output';

interface DiffOptions extends DiffRawOptions {
  config?: string;
  printConfig?: boolean;
}

@Command({
  name: 'diff',
  description:
    'Compute a semantic diff between two RDF sources via RDFC-1.0 canonicalization. Note: RDFC-1.0 does not normalize literal lexical forms.',
  arguments: '[left] [right]',
})
export class DiffCommand extends CommandRunner {
  async run(passedParams: string[], options: DiffOptions = {}): Promise<void> {
    const adapted = diffAdapter(passedParams, options);
    if (isAdapterFailure(adapted)) {
      for (const err of adapted.errors) {
        process.stderr.write(`error: ${err.message}\n`);
      }
      process.exitCode = exitCodeFor('diff');
      return;
    }

    await runWithConfig(
      {
        command: 'diff',
        passedParams: [],
        options,
        cliOverrides: adapted.cliOverrides,
      },
      (effective) => this.execute(effective),
    );
  }

  private async execute(effective: EffectiveOptions): Promise<void> {
    const logger = new Logger('sparqly');

    if (effective.left === undefined || effective.right === undefined) {
      process.stderr.write(
        'error: diff requires two source specs (left and right)\n',
      );
      process.exitCode = 2;
      return;
    }

    const graphStrategy: GraphStrategy | undefined = effective.graphStrategy;
    const format = (effective.format ?? 'human') as DiffFormat;
    const quiet = effective.quiet === true;

    let leftStatements: string[];
    let rightStatements: string[];
    let sourcePrefixes: Record<string, Record<string, string>>;
    try {
      const start = Date.now();
      const [leftResult, rightResult] = await Promise.all([
        canonicalizeRdf({ sources: effective.left, graphStrategy }),
        canonicalizeRdf({ sources: effective.right, graphStrategy }),
      ]);
      logger.log(
        `Loaded ${leftResult.files.length} left + ${rightResult.files.length} right file(s), canonicalized in ${Date.now() - start}ms`,
      );
      leftStatements = leftResult.canonicalStatements;
      rightStatements = rightResult.canonicalStatements;
      sourcePrefixes = { ...leftResult.prefixes, ...rightResult.prefixes };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`error: ${message}\n`);
      process.exitCode = 2;
      return;
    }

    const diff = diffCanonicalStatements(leftStatements, rightStatements);
    const resolvedPrefixes = resolveDiffPrefixes(
      effective.prefixes ?? {},
      sourcePrefixes,
    );
    const body =
      format === 'turtle'
        ? renderTurtleBlocks(diff, resolvedPrefixes)
        : format === 'human'
          ? renderHumanShortened(diff, resolvedPrefixes)
          : formatRdfDiff(diff, format);
    const { added, removed } = diff;

    if (effective.out !== undefined) {
      try {
        await writeOutputToFile({
          out: effective.out,
          cwd: process.cwd(),
          body,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`error: ${message}\n`);
        process.exitCode = 2;
        return;
      }
    } else {
      process.stdout.write(body);
    }

    if (!quiet) {
      process.stderr.write(`# +${added.length} -${removed.length}\n`);
    }

    process.exitCode = added.length === 0 && removed.length === 0 ? 0 : 1;
  }

  @Option({
    flags: '--left <source>',
    description:
      'Left-hand source spec (file path or glob). Alternative to the first positional argument.',
  })
  parseLeft(value: string): string {
    return value;
  }

  @Option({
    flags: '--right <source>',
    description:
      'Right-hand source spec (file path or glob). Alternative to the second positional argument.',
  })
  parseRight(value: string): string {
    return value;
  }

  @Option({
    flags: '--graph-strategy <strategy>',
    description:
      "Named-graph strategy: 'default', 'partial', 'full', or 'none' (see `query --help`)",
  })
  parseGraphStrategy(value: string): string {
    return value;
  }

  @Option({
    flags: '-f, --format <format>',
    description: `Output format: ${DIFF_FORMATS.map((f) => `'${f}'`).join(', ')}.`,
  })
  parseFormat(value: string): string {
    return value;
  }

  @Option({ flags: '-v, --verbose', description: 'Verbose logging' })
  parseVerbose(): boolean {
    return true;
  }

  @Option({
    flags: '--quiet',
    description:
      'Suppress the trailing "# +<added> -<removed>" summary line on stderr.',
  })
  parseQuiet(): boolean {
    return true;
  }

  @Option({
    flags: '-o, --out <path>',
    description:
      'Write the diff body to <path> (CWD-relative) instead of stdout. The "# +N -M" summary still goes to stderr. Creates parent directories, silently overwrites, and replaces symlinks at the target.',
  })
  parseOut(value: string): string {
    return value;
  }

  @Option({
    flags: '--config <path>',
    description:
      'Path to a sparqly.config.{yaml,yml,json} file. Disables auto-discovery; hard error if the path is missing or unparseable. See README "Configuration file".',
  })
  parseConfig(value: string): string {
    return value;
  }

  @Option({
    flags: '--print-config',
    description:
      'Print the fully-merged effective configuration with the source of each value (default/file/env/flag) and exit 0. See README "Configuration file".',
  })
  parsePrintConfig(): boolean {
    return true;
  }
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
