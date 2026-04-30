import { Logger } from '@nestjs/common';
import { Parser, type Term } from 'n3';
import { Command, CommandRunner, Option } from 'nest-commander';
import { canonicalizeRdf, type GraphStrategy } from 'core';
import { runWithConfig, type EffectiveOptions } from './config';
import { DIFF_FORMATS, type DiffFormat } from './config/internal/schema';
import { exitCodeFor, isAdapterFailure } from './cli-errors';
import { diffAdapter, type DiffRawOptions } from './diff.adapter';

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
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`error: ${message}\n`);
      process.exitCode = 2;
      return;
    }

    const leftSet = new Set(leftStatements);
    const rightSet = new Set(rightStatements);
    const removed = leftStatements.filter((s) => !rightSet.has(s)).sort();
    const added = rightStatements.filter((s) => !leftSet.has(s)).sort();

    if (format === 'json') {
      const body = {
        added: added.map(parseStatement),
        removed: removed.map(parseStatement),
      };
      process.stdout.write(`${JSON.stringify(body)}\n`);
    } else if (format === 'rdf-patch') {
      for (const s of removed) process.stdout.write(`D ${s}\n`);
      for (const s of added) process.stdout.write(`A ${s}\n`);
    } else {
      for (const s of removed) process.stdout.write(`- ${s}\n`);
      for (const s of added) process.stdout.write(`+ ${s}\n`);
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

interface StatementJson {
  s: TermJson;
  p: TermJson;
  o: TermJson;
  g?: TermJson;
}

interface TermJson {
  termType: string;
  value: string;
  datatype?: string;
  language?: string;
}

function parseStatement(line: string): StatementJson {
  const parser = new Parser({ format: 'application/n-quads' });
  const quads = parser.parse(line);
  if (quads.length !== 1) {
    throw new Error(`expected exactly one quad, got ${quads.length}: ${line}`);
  }
  const q = quads[0];
  const out: StatementJson = {
    s: termToJson(q.subject),
    p: termToJson(q.predicate),
    o: termToJson(q.object),
  };
  if (q.graph.termType !== 'DefaultGraph') {
    out.g = termToJson(q.graph);
  }
  return out;
}

function termToJson(term: Term): TermJson {
  const out: TermJson = { termType: term.termType, value: term.value };
  if (term.termType === 'Literal') {
    const lit = term as Term & {
      language?: string;
      datatype?: { value: string };
    };
    if (lit.language && lit.language.length > 0) out.language = lit.language;
    if (lit.datatype && lit.datatype.value) out.datatype = lit.datatype.value;
  }
  return out;
}
