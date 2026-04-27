import { join } from 'node:path';
import { Command, CommandRunner, Option } from 'nest-commander';
import {
  GRAPH_STRATEGIES,
  isGraphStrategy,
  type GraphStrategy,
} from 'core';
import { createServer } from 'server';
import { configureLogger } from './logging';

const WEB_BUNDLE_DIR = join(__dirname, 'web');

interface ServeOptions {
  sources?: string;
  port?: number;
  graphStrategy?: string;
  mutable?: boolean;
  immutable?: boolean;
  verbose?: boolean;
  quiet?: boolean;
  watch?: boolean;
  watchDebounce?: number;
}

@Command({
  name: 'serve',
  description: 'Serve a W3C SPARQL Protocol endpoint at /api/sparql',
  arguments: '[glob]',
})
export class ServeCommand extends CommandRunner {
  async run(passedParams: string[], options: ServeOptions = {}): Promise<void> {
    configureLogger(options);

    const sources = options.sources ?? passedParams[0];
    if (!sources) {
      process.stderr.write('error: a sources glob is required\n');
      process.exitCode = 1;
      return;
    }

    let graphStrategy: GraphStrategy | undefined;
    if (options.graphStrategy !== undefined) {
      if (!isGraphStrategy(options.graphStrategy)) {
        process.stderr.write(
          `error: unknown --graph-strategy '${options.graphStrategy}' (expected ${GRAPH_STRATEGIES.join(', ')})\n`,
        );
        process.exitCode = 1;
        return;
      }
      graphStrategy = options.graphStrategy;
    }

    const port = options.port ?? 3000;
    const mutable = options.mutable === true || options.immutable === false;

    try {
      await createServer({
        sources,
        port,
        mutable,
        graphStrategy,
        webRootDir: WEB_BUNDLE_DIR,
        watch: options.watch === true,
        watchDebounceMs: options.watchDebounce,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`error: ${message}\n`);
      process.exitCode = 1;
    }
  }

  @Option({
    flags: '-s, --sources <glob>',
    description: 'Glob of RDF files to load (alternative to positional arg)',
  })
  parseSources(value: string): string {
    return value;
  }

  @Option({
    flags: '-p, --port <port>',
    description: 'HTTP port (default: 3000)',
  })
  parsePort(value: string): number {
    return Number.parseInt(value, 10);
  }

  @Option({
    flags: '--graph-strategy <strategy>',
    description:
      "Named-graph strategy: 'default', 'partial', or 'full' (see `query --help`)",
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

  @Option({
    flags: '--watch',
    description:
      'Watch the sources glob and rebuild the in-memory store on change (debounced). Default: off.',
  })
  parseWatch(): boolean {
    return true;
  }

  @Option({
    flags: '--watch-debounce <ms>',
    description: 'Debounce window for --watch in milliseconds (default: 250)',
  })
  parseWatchDebounce(value: string): number {
    return Number.parseInt(value, 10);
  }

  @Option({ flags: '-v, --verbose', description: 'Verbose logging' })
  parseVerbose(): boolean {
    return true;
  }

  @Option({ flags: '--quiet', description: 'Suppress non-error logging' })
  parseQuiet(): boolean {
    return true;
  }
}
