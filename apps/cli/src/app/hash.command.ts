import { createHash } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { Command, CommandRunner, Option } from 'nest-commander';
import {
  canonicalizeRdf,
  GRAPH_STRATEGIES,
  isGraphStrategy,
  type GraphStrategy,
} from 'core';
import { runWithConfig, type EffectiveOptions } from './config';

interface HashOptions {
  sources?: string[];
  graphStrategy?: string;
  json?: boolean;
  compareWith?: string;
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
    if (options.compareWith !== undefined)
      cliOverrides.compareWith = options.compareWith;
    if (options.verbose !== undefined) cliOverrides.verbose = options.verbose;
    if (options.quiet !== undefined) cliOverrides.quiet = options.quiet;

    const errorExit = options.compareWith !== undefined ? 2 : 1;

    if (options.graphStrategy !== undefined) {
      if (!isGraphStrategy(options.graphStrategy)) {
        process.stderr.write(
          `error: unknown --graph-strategy '${options.graphStrategy}' (expected ${GRAPH_STRATEGIES.join(', ')})\n`,
        );
        process.exitCode = errorExit;
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
    const isCompareMode = effective.compareWith !== undefined;
    const errorExit = isCompareMode ? 2 : 1;

    const sourceSpecs =
      effective.sources === undefined
        ? []
        : Array.isArray(effective.sources)
          ? effective.sources
          : [effective.sources];
    const graphStrategy: GraphStrategy | undefined = effective.graphStrategy;

    if (isCompareMode) {
      if (sourceSpecs.length !== 1) {
        process.stderr.write(
          'error: --compare-with requires exactly one primary source\n',
        );
        process.exitCode = errorExit;
        return;
      }
    } else if (sourceSpecs.length === 0) {
      process.stderr.write('error: a sources glob is required\n');
      process.exitCode = errorExit;
      return;
    }

    if (isCompareMode) {
      const compareSpec = effective.compareWith as string;
      let primary: { source: string; hash: string };
      let secondary: { source: string; hash: string };
      try {
        primary = await this.hashSource(sourceSpecs[0], graphStrategy, logger);
        secondary = await this.hashSource(compareSpec, graphStrategy, logger);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`error: ${message}\n`);
        process.exitCode = errorExit;
        return;
      }

      if (primary.hash === secondary.hash) {
        process.stdout.write(`match: ${primary.hash}\n`);
        return;
      }
      process.stdout.write(`${primary.hash}  ${primary.source}\n`);
      process.stdout.write(`${secondary.hash}  ${secondary.source}\n`);
      process.exitCode = 1;
      return;
    }

    const results: Array<{ source: string; hash: string }> = [];
    for (const spec of sourceSpecs) {
      try {
        results.push(await this.hashSource(spec, graphStrategy, logger));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`error: ${message}\n`);
        process.exitCode = errorExit;
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

  private async hashSource(
    spec: string,
    graphStrategy: GraphStrategy | undefined,
    logger: Logger,
  ): Promise<{ source: string; hash: string }> {
    const start = Date.now();
    const { store, files, canonicalText } = await canonicalizeRdf({
      sources: spec,
      graphStrategy,
    });
    const hash = createHash('sha256').update(canonicalText).digest('hex');
    logger.log(
      `Loaded ${files.length} file(s) (${store.size} quads), canonicalized + hashed '${spec}' in ${Date.now() - start}ms`,
    );

    return { source: spec, hash };
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
      'Emit a JSON array of { source, hash } objects in input order instead of the default <hash>  <source-spec> lines. Not applicable in --compare-with mode.',
  })
  parseJson(): boolean {
    return true;
  }

  @Option({
    flags: '--compare-with <source>',
    description:
      "Hash a second source spec (file path or glob) with the same loader options and compare against the primary source. Exit 0 on match (stdout 'match: <hash>'), 1 on mismatch (stdout shows both labeled hashes), 2 on error. Requires exactly one primary source.",
  })
  parseCompareWith(value: string): string {
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
