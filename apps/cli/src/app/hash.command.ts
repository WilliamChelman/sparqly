import { createHash } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { Command, CommandRunner, Option } from 'nest-commander';
import * as rdfCanonize from 'rdf-canonize';
import {
  GRAPH_STRATEGIES,
  isGraphStrategy,
  loadRdf,
  type GraphStrategy,
} from 'core';
import { runWithConfig, type EffectiveOptions } from './config';

interface HashOptions {
  sources?: string;
  graphStrategy?: string;
  verbose?: boolean;
  quiet?: boolean;
  config?: string;
  printConfig?: boolean;
}

@Command({
  name: 'hash',
  description:
    'Compute a stable SHA-256 over the canonicalized RDF content of a source',
  arguments: '[glob]',
})
export class HashCommand extends CommandRunner {
  async run(passedParams: string[], options: HashOptions = {}): Promise<void> {
    const cliOverrides: Partial<EffectiveOptions> = {};
    if (options.sources !== undefined) cliOverrides.sources = options.sources;
    if (options.verbose !== undefined) cliOverrides.verbose = options.verbose;
    if (options.quiet !== undefined) cliOverrides.quiet = options.quiet;

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

    await runWithConfig(
      { command: 'hash', passedParams, options, cliOverrides },
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

    const graphStrategy: GraphStrategy | undefined = effective.graphStrategy;

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

      const canonStart = Date.now();
      const canonical = await rdfCanonize.canonize(
        store.getQuads(null, null, null, null),
        {
          algorithm: 'RDFC-1.0',
          format: 'application/n-quads',
        },
      );
      const hash = createHash('sha256').update(canonical).digest('hex');
      logger.log(`Canonicalized + hashed in ${Date.now() - canonStart}ms`);

      process.stdout.write(`${hash}  ${effective.sources}\n`);
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
    flags: '--graph-strategy <strategy>',
    description:
      "Named-graph strategy: 'default', 'partial', 'full', or 'none' (see `query --help`)",
  })
  parseGraphStrategy(value: string): string {
    return value;
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
