import { readFile } from 'node:fs/promises';
import { Logger, type LogLevel } from '@nestjs/common';
import { Command, CommandRunner, Option } from 'nest-commander';
import { QueryEngine, isSparqlFormat, loadRdf } from 'core';

interface QueryOptions {
  sources?: string;
  query?: string;
  queryFile?: string;
  format?: string;
  mutable?: boolean;
  immutable?: boolean;
  verbose?: boolean;
  quiet?: boolean;
}

@Command({
  name: 'query',
  description: 'Run a SPARQL query against a glob of RDF files',
  arguments: '[glob]',
})
export class QueryCommand extends CommandRunner {
  async run(passedParams: string[], options: QueryOptions = {}): Promise<void> {
    configureLogger(options);
    const logger = new Logger('sparqly');

    const sources = options.sources ?? passedParams[0];
    if (!sources) {
      process.stderr.write('error: a sources glob is required\n');
      process.exitCode = 1;
      return;
    }
    const stdinQuery = await this.readStdin();
    const querySources: string[] = [];
    if (options.query) querySources.push('-q/--query');
    if (options.queryFile) querySources.push('--query-file');
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
    if (options.query) {
      query = options.query;
    } else if (options.queryFile) {
      try {
        query = await readFile(options.queryFile, 'utf8');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`error: failed to read --query-file: ${message}\n`);
        process.exitCode = 1;
        return;
      }
    } else {
      query = stdinQuery as string;
    }

    let format: 'json' | 'turtle' | undefined;
    if (options.format !== undefined) {
      if (!isSparqlFormat(options.format)) {
        process.stderr.write(
          `error: unknown --format '${options.format}' (expected 'json' or 'turtle')\n`,
        );
        process.exitCode = 1;
        return;
      }
      format = options.format;
    }

    try {
      const loadStart = Date.now();
      const { store, files } = await loadRdf({ sources });
      logger.log(
        `Loaded ${files.length} file(s) (${store.size} quads) in ${
          Date.now() - loadStart
        }ms`,
      );

      const queryStart = Date.now();
      const engine = new QueryEngine(store);
      const result = await engine.execute(query, { format });
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
    flags: '--mutable',
    description: 'Allow mutating queries (UPDATE/INSERT/DELETE/LOAD)',
  })
  parseMutable(): boolean {
    return true;
  }

  @Option({
    flags: '--immutable [value]',
    description: 'Disallow mutating queries (default: true)',
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
}

function configureLogger(options: QueryOptions): void {
  if (options.quiet) {
    Logger.overrideLogger(false);
    return;
  }
  const levels: LogLevel[] = options.verbose
    ? ['error', 'warn', 'log', 'debug', 'verbose']
    : ['error', 'warn'];
  Logger.overrideLogger(new StderrLogger(levels));
}

class StderrLogger {
  constructor(private readonly levels: ReadonlyArray<LogLevel>) {}

  private write(level: LogLevel, message: unknown, context?: string): void {
    if (!this.levels.includes(level)) return;
    const text = typeof message === 'string' ? message : JSON.stringify(message);
    const prefix = context ? `[${context}] ` : '';
    process.stderr.write(`${prefix}${text}\n`);
  }

  log(message: unknown, context?: string): void {
    this.write('log', message, context);
  }
  error(message: unknown, _trace?: string, context?: string): void {
    this.write('error', message, context);
  }
  warn(message: unknown, context?: string): void {
    this.write('warn', message, context);
  }
  debug(message: unknown, context?: string): void {
    this.write('debug', message, context);
  }
  verbose(message: unknown, context?: string): void {
    this.write('verbose', message, context);
  }
}
