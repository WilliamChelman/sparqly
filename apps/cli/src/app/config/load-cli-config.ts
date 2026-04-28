import { Logger } from '@nestjs/common';
import { configureLogger } from '../logging';
import { readEnv } from './env-config';
import { ConfigError, resolveConfig } from './resolve-config';
import { resolveEffective } from './resolve-effective';
import type { CommandName, EffectiveOptions } from './schema';

export interface LoadCliConfigInput<C extends CommandName> {
  command: C;
  configPath?: string;
  cliOverrides: Partial<EffectiveOptions>;
  positionalSources?: string;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

export interface LoadedCliConfig {
  effective: EffectiveOptions;
  filepath: string | null;
}

/**
 * Loads the on-disk config file, layers env vars and CLI overrides on top, and
 * configures the Nest logger. On a `ConfigError`, writes to stderr and sets
 * `process.exitCode = 1`, returning `null` so the caller can early-return.
 */
export async function loadCliConfig<C extends CommandName>(
  input: LoadCliConfigInput<C>,
): Promise<LoadedCliConfig | null> {
  const env = input.env ?? process.env;
  const cwd = input.cwd ?? process.cwd();

  let resolved;
  let envLayer;
  try {
    resolved = await resolveConfig({ cwd, configPath: input.configPath });
    envLayer = readEnv(input.command, env);
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(`error: ${err.message}\n`);
      process.exitCode = 1;
      return null;
    }
    throw err;
  }

  const effective = resolveEffective({
    command: input.command,
    resolved,
    env: envLayer,
    cliOverrides: input.cliOverrides,
    positionalSources: input.positionalSources,
  });

  configureLogger({ verbose: effective.verbose, quiet: effective.quiet });
  if (resolved.filepath && effective.verbose) {
    new Logger('sparqly').log(`Loaded config from ${resolved.filepath}`);
  }

  return { effective, filepath: resolved.filepath };
}
