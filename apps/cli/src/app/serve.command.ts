import { join } from 'node:path';
import { Command, CommandRunner, Option } from 'nest-commander';
import { type GraphStrategy } from 'core';
import { createServer } from 'server';
import { runWithConfig, type EffectiveOptions } from './config';
import { exitCodeFor, isAdapterFailure } from './cli-errors';
import { serveAdapter, type ServeRawOptions } from './serve.adapter';

const WEB_BUNDLE_DIR = join(__dirname, 'web');

interface ServeOptions extends ServeRawOptions {
  config?: string;
  printConfig?: boolean;
}

@Command({
  name: 'serve',
  description: 'Serve a W3C SPARQL Protocol endpoint at /api/sparql',
  arguments: '[glob]',
})
export class ServeCommand extends CommandRunner {
  async run(passedParams: string[], options: ServeOptions = {}): Promise<void> {
    const adapted = serveAdapter(passedParams, options);
    if (isAdapterFailure(adapted)) {
      for (const err of adapted.errors) {
        process.stderr.write(`error: ${err.message}\n`);
      }
      process.exitCode = exitCodeFor('serve');
      return;
    }

    await runWithConfig(
      {
        command: 'serve',
        passedParams,
        options,
        cliOverrides: adapted.cliOverrides,
      },
      (effective) => this.execute(effective),
    );
  }

  private async execute(effective: EffectiveOptions): Promise<void> {
    if (!effective.sources) {
      process.stderr.write('error: a sources glob is required\n');
      process.exitCode = 1;
      return;
    }

    const graphStrategy: GraphStrategy | undefined = effective.graphStrategy;
    const port = effective.port ?? 3000;
    const mutable = effective.mutable === true;

    try {
      await createServer({
        sources: effective.sources,
        port,
        mutable,
        graphStrategy,
        webRootDir: WEB_BUNDLE_DIR,
        watch: effective.watch === true,
        watchDebounceMs: effective.watchDebounce,
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
      "Named-graph strategy: 'default', 'partial', 'full', or 'none' (see `query --help`)",
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
