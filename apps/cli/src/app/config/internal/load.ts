import { Logger } from '@nestjs/common';
import { configureLogger } from '../../logging';
import { readEnv } from './env-config';
import { ConfigError } from './errors';
import { loadFileConfig } from './file-config';
import { formatPrintConfig, merge } from './effective';
import type { CommandName, EffectiveOptions } from './schema';

export interface LoadConfigInput<C extends CommandName> {
  command: C;
  cliOverrides: Partial<EffectiveOptions>;
  positionalSources?: string;
  configPath?: string;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

export interface LoadedConfig {
  effective: EffectiveOptions;
  filepath: string | null;
  printConfig: string;
}

export async function loadConfig<C extends CommandName>(
  input: LoadConfigInput<C>,
): Promise<LoadedConfig | null> {
  const env = input.env ?? process.env;
  const cwd = input.cwd ?? process.cwd();

  let file;
  let envLayer;
  try {
    file = await loadFileConfig({ cwd, configPath: input.configPath });
    envLayer = readEnv(input.command, env);
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(`error: ${err.message}\n`);
      process.exitCode = 1;
      return null;
    }
    throw err;
  }

  const result = merge({
    command: input.command,
    file,
    env: envLayer,
    cliOverrides: input.cliOverrides,
    positionalSources: input.positionalSources,
  });
  const printConfig = formatPrintConfig({
    command: input.command,
    result,
    filepath: file.filepath,
  });

  configureLogger({
    verbose: result.effective.verbose,
    quiet: result.effective.quiet,
  });
  if (file.filepath && result.effective.verbose) {
    new Logger('sparqly').log(`Loaded config from ${file.filepath}`);
  }

  return {
    effective: result.effective,
    filepath: file.filepath,
    printConfig,
  };
}

export interface RunWithConfigInput<C extends CommandName> {
  command: C;
  passedParams: string[];
  options: { config?: string; printConfig?: boolean };
  cliOverrides: Partial<EffectiveOptions>;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
}

export async function runWithConfig<C extends CommandName>(
  input: RunWithConfigInput<C>,
  handler: (
    effective: EffectiveOptions,
    filepath: string | null,
  ) => void | Promise<void>,
): Promise<void> {
  const loaded = await loadConfig({
    command: input.command,
    cliOverrides: input.cliOverrides,
    positionalSources: input.passedParams[0],
    configPath: input.options.config,
    env: input.env,
    cwd: input.cwd,
  });
  if (!loaded) return;

  if (input.options.printConfig) {
    (input.stdout ?? process.stdout).write(loaded.printConfig);
    return;
  }

  await handler(loaded.effective, loaded.filepath);
}
