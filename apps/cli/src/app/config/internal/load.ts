import { Logger } from '@nestjs/common';
import { COMMAND_REGISTRY } from '../../commands/registry';
import { configureLogger } from '../../logging';
import { readEnv } from './env-config';
import { ConfigError } from './errors';
import { loadFileConfig } from './file-config';
import { formatPrintConfig, merge } from './effective';
import type { CommandName } from './schema';

export interface LoadConfigInput<C extends CommandName> {
  command: C;
  cliOverrides: Record<string, unknown>;
  positionalSources?: string;
  configPath?: string;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

export interface LoadedConfig {
  effective: Record<string, unknown>;
  filepath: string | null;
  printConfig: string;
}

export async function loadConfig<C extends CommandName>(
  input: LoadConfigInput<C>,
): Promise<LoadedConfig | null> {
  const env = input.env ?? process.env;
  const cwd = input.cwd ?? process.cwd();

  const spec = COMMAND_REGISTRY.get(input.command);
  if (!spec) throw new Error(`unknown command: ${input.command}`);

  let file;
  let envLayer;
  try {
    file = await loadFileConfig({ cwd, configPath: input.configPath });
    envLayer = readEnv(spec, env);
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(`error: ${err.message}\n`);
      process.exitCode = 1;
      return null;
    }
    throw err;
  }

  const result = merge({
    spec,
    file,
    env: envLayer,
    cliOverrides: input.cliOverrides,
    positionalSources: input.positionalSources,
  });
  const printConfig = formatPrintConfig({
    spec,
    result,
    filepath: file.filepath,
  });

  configureLogger({
    verbose: result.effective.verbose === true,
    quiet: result.effective.quiet === true,
  });
  if (file.filepath && result.effective.verbose === true) {
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
  cliOverrides: Record<string, unknown>;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
}

export async function runWithConfig<C extends CommandName>(
  input: RunWithConfigInput<C>,
  handler: (
    effective: Record<string, unknown>,
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
