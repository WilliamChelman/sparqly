import { Logger } from '@nestjs/common';
import { configureLogger } from '../logging';
import { ConfigError, resolveConfig } from './resolve-config';
import type { SharedConfig } from './schema';

export interface CliSharedOptions {
  configPath?: string;
  verbose?: boolean;
  quiet?: boolean;
}

export interface LoadedCliConfig {
  config: SharedConfig;
  filepath: string | null;
  verbose: boolean | undefined;
  quiet: boolean | undefined;
}

/**
 * Resolves the on-disk config file, then configures the Nest logger using the
 * CLI > file precedence for `verbose`/`quiet`. Writes the error and sets
 * `process.exitCode` itself on a `ConfigError`, returning `null` so the caller
 * can early-return.
 */
export async function loadCliConfig(
  options: CliSharedOptions,
): Promise<LoadedCliConfig | null> {
  let resolved;
  try {
    resolved = await resolveConfig({
      cwd: process.cwd(),
      configPath: options.configPath,
    });
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(`error: ${err.message}\n`);
      process.exitCode = 1;
      return null;
    }
    throw err;
  }

  const verbose = options.verbose ?? resolved.config.verbose;
  const quiet = options.quiet ?? resolved.config.quiet;
  configureLogger({ verbose, quiet });
  if (resolved.filepath && verbose) {
    new Logger('sparqly').log(`Loaded config from ${resolved.filepath}`);
  }

  return { ...resolved, verbose, quiet };
}
