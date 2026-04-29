import { readFile } from 'node:fs/promises';
import { Logger } from '@nestjs/common';
import { Command, CommandRunner, Option } from 'nest-commander';
import {
  GRAPH_STRATEGIES,
  QueryEngine,
  isGraphStrategy,
  isSparqlFormat,
  loadRdf,
  type GraphStrategy,
} from 'core';
import { runWithConfig, type EffectiveOptions } from './config';

interface QueryOptions {
  sources?: string;
  query?: string;
  queryFile?: string;
  format?: string;
  graphStrategy?: string;
  mutable?: boolean;
  immutable?: boolean;
  verbose?: boolean;
  quiet?: boolean;
  config?: string;
  printConfig?: boolean;
}

@Command({
  name: 'query',
  description: 'Run a SPARQL query against a glob of RDF files',
  arguments: '[glob]',
})
export class QueryCommand extends CommandRunner {
  async run(passedParams: string[], options: QueryOptions = {}): Promise<void> {
    const cliOverrides: Partial<EffectiveOptions> = {};
    if (options.sources !== undefined) cliOverrides.sources = options.sources;
    if (options.query !== undefined) cliOverrides.query = options.query;
    if (options.queryFile !== undefined)
      cliOverrides.queryFile = options.queryFile;
    if (options.verbose !== undefined) cliOverrides.verbose = options.verbose;
    if (options.quiet !== undefined) cliOverrides.quiet = options.quiet;

    if (options.format !== undefined) {
      if (!isSparqlFormat(options.format)) {
        process.stderr.write(
          `error: unknown --format '${options.format}' (expected 'json' or 'turtle')\n`,
        );
        process.exitCode = 1;
        return;
      }
      cliOverrides.format = options.format;
    }
    if (options.graphStrategy !== undefined) {
      if (!isGraphStrategy(options.graphStrategy)) {
        process.stderr.write(
          `error: unknown --graph-strategy '${options.graphStrategy}' (expected ${GRAPH_STRATEGIES.join(', ')})\n`,
        );
        process.exitCode = 1;
        return;
      }
      cliOverrides.graphStrategy = options.graphStrategy;
    }
    const cliMutable = mutableFromCli(options);
    if (cliMutable !== undefined) cliOverrides.mutable = cliMutable;

    await runWithConfig(
      { command: 'query', passedParams, options, cliOverrides },
      (effective) => this.execute(effective),
    );
  }

  private async execute(effective: EffectiveOptions): Promise<void> {
    const logger = new Logger('sparqly');

    if (!effective.sources) {
      process.stderr.write('error: a sources glob is required\n');
      process.exitCode = 1;
      return;
    }
    const stdinQuery = await this.readStdin();
    const querySources: string[] = [];
    if (effective.query) querySources.push('-q/--query');
    if (effective.queryFile) querySources.push('--query-file');
    if (stdinQuery) querySources.push('stdin');

    if (querySources.length > 1) {
      process.stderr.write(
        `error: only one query source allowed (got ${querySources.join(', ')})\n`,
      );
      process.exitCode = 1;
      return;
    }
    if (querySources.length === 0) {
      process.stderr.write(
        'error: a query is required (-q, --query-file, or stdin)\n',
      );
      process.exitCode = 1;
      return;
    }

    let query: string;
    if (effective.query) {
      query = effective.query;
    } else if (effective.queryFile) {
      try {
        query = await readFile(effective.queryFile, 'utf8');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`error: failed to read --query-file: ${message}\n`);
        process.exitCode = 1;
        return;
      }
    } else {
      query = stdinQuery as string;
    }

    const graphStrategy: GraphStrategy | undefined = effective.graphStrategy;
    const format = effective.format;
    const mutable = effective.mutable === true;

    try {
      const loadStart = Date.now();
      const { store, files } = await loadRdf({
        sources: effective.sources,
        graphStrategy,
      });
      logger.log(
        `Loaded ${files.length} file(s) (${store.size} quads) in ${
          Date.now() - loadStart
        }ms`,
      );

      const queryStart = Date.now();
      const engine = new QueryEngine(store);
      const result = await engine.execute(query, { format, mutable });
      logger.log(`Query executed in ${Date.now() - queryStart}ms`);

      process.stdout.write(result.body);
      if (!result.body.endsWith('\n')) process.stdout.write('\n');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`error: ${message}\n`);
      process.exitCode = 1;
    }
  }

  async readStdin(): Promise<string | null> {
    if (process.stdin.isTTY) return null;
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const text = Buffer.concat(chunks).toString('utf8').trim();
    return text.length > 0 ? text : null;
  }

  @Option({
    flags: '-s, --sources <glob>',
    description: 'Glob of RDF files to load (alternative to positional arg)',
  })
  parseSources(value: string): string {
    return value;
  }

  @Option({
    flags: '-q, --query <sparql>',
    description: 'Inline SPARQL query',
  })
  parseQuery(value: string): string {
    return value;
  }

  @Option({
    flags: '--query-file <path>',
    description: 'Path to a file containing the SPARQL query',
  })
  parseQueryFile(value: string): string {
    return value;
  }

  @Option({
    flags: '-f, --format <format>',
    description: 'Override the output format',
  })
  parseFormat(value: string): string {
    return value;
  }

  @Option({
    flags: '--graph-strategy <strategy>',
    description:
      "Named-graph strategy: 'default' (triples merge into the default graph, quads keep declared graphs), 'partial' (triples land in their file:// graph, quads keep declared graphs), or 'full' (every file lands in its own file:// graph)",
  })
  parseGraphStrategy(value: string): string {
    return value;
  }

  @Option({
    flags: '--mutable',
    description:
      'Allow mutating queries (UPDATE/INSERT/DELETE/LOAD). Alias for --immutable=false. Default: mutating queries are rejected.',
  })
  parseMutable(): boolean {
    return true;
  }

  @Option({
    flags: '--immutable [value]',
    description:
      'Reject mutating queries (default: true). Pass --immutable=false to opt in; equivalent to --mutable.',
  })
  parseImmutable(value: string): boolean {
    return value !== 'false';
  }

  @Option({ flags: '-v, --verbose', description: 'Verbose logging' })
  parseVerbose(): boolean {
    return true;
  }

  @Option({ flags: '--quiet', description: 'Suppress non-result output' })
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

export function mutableFromCli(options: {
  mutable?: boolean;
  immutable?: boolean;
}): boolean | undefined {
  if (options.mutable === true) return true;
  if (options.immutable !== undefined) return options.immutable === false;
  return undefined;
}
