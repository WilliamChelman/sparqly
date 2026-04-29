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
  sources?: string[];
  graphStrategy?: string;
  json?: boolean;
  verbose?: boolean;
  quiet?: boolean;
  config?: string;
  printConfig?: boolean;
}

@Command({
  name: 'hash',
  description:
    'Compute a stable SHA-256 over the canonicalized RDF content of one or more sources',
  arguments: '[glob]',
})
export class HashCommand extends CommandRunner {
  async run(passedParams: string[], options: HashOptions = {}): Promise<void> {
    const cliOverrides: Partial<EffectiveOptions> = {};
    if (options.sources !== undefined) cliOverrides.sources = options.sources;
    if (options.json !== undefined) cliOverrides.json = options.json;
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

    if (
      effective.sources === undefined ||
      (Array.isArray(effective.sources) && effective.sources.length === 0)
    ) {
      process.stderr.write('error: a sources glob is required\n');
      process.exitCode = 1;
      return;
    }

    const sourceSpecs = Array.isArray(effective.sources)
      ? effective.sources
      : [effective.sources];
    const graphStrategy: GraphStrategy | undefined = effective.graphStrategy;

    const results: Array<{ source: string; hash: string }> = [];
    for (const spec of sourceSpecs) {
      try {
        const loadStart = Date.now();
        const { store, files } = await loadRdf({
          sources: spec,
          graphStrategy,
        });
        logger.log(
          `Loaded ${files.length} file(s) (${store.size} quads) for '${spec}' in ${
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
        logger.log(
          `Canonicalized + hashed '${spec}' in ${Date.now() - canonStart}ms`,
        );

        results.push({ source: spec, hash });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`error: ${message}\n`);
        process.exitCode = 1;
        return;
      }
    }

    if (effective.json) {
      process.stdout.write(`${JSON.stringify(results)}\n`);
    } else {
      for (const { hash, source } of results) {
        process.stdout.write(`${hash}  ${source}\n`);
      }
    }
  }

  @Option({
    flags: '-s, --sources <glob>',
    description:
      'Glob of RDF files to load (alternative to positional arg). Repeat to hash multiple sources independently.',
  })
  parseSources(value: string, previous: string[] = []): string[] {
    return [...previous, value];
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
    flags: '--json',
    description:
      'Emit a JSON array of { source, hash } objects in input order instead of the default <hash>  <source-spec> lines.',
  })
  parseJson(): boolean {
    return true;
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
