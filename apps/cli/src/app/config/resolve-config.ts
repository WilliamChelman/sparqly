import { cosmiconfig, type CosmiconfigResult } from 'cosmiconfig';
import { z } from 'zod';
import {
  SHARED_CONFIG_KEYS,
  sharedConfigSchema,
  type SharedConfig,
} from './schema';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export interface ResolveConfigOptions {
  cwd?: string;
  configPath?: string;
  stopDir?: string;
  warn?: (message: string) => void;
}

export interface ResolvedConfig {
  config: SharedConfig;
  filepath: string | null;
}

const SEARCH_PLACES = [
  'sparqly.config.yaml',
  'sparqly.config.yml',
  'sparqly.config.json',
];

const KNOWN_KEYS: ReadonlySet<string> = new Set(SHARED_CONFIG_KEYS);

export async function resolveConfig(
  options: ResolveConfigOptions = {},
): Promise<ResolvedConfig> {
  const explorer = cosmiconfig('sparqly', {
    searchPlaces: SEARCH_PLACES,
    stopDir: options.stopDir,
  });

  let result: CosmiconfigResult;
  if (options.configPath) {
    try {
      result = await explorer.load(options.configPath);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new ConfigError(
        `failed to load --config '${options.configPath}': ${message}`,
      );
    }
  } else {
    try {
      result = await explorer.search(options.cwd);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new ConfigError(`failed to load config: ${message}`);
    }
  }

  if (!result || result.isEmpty) {
    return { config: {}, filepath: null };
  }

  const raw = result.config;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ConfigError(
      `config at ${result.filepath} must be an object, got ${describeType(raw)}`,
    );
  }

  const parsed = sharedConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ConfigError(formatZodError(parsed.error, result.filepath));
  }

  const warn = options.warn ?? defaultWarn;
  for (const key of Object.keys(raw as Record<string, unknown>)) {
    if (!KNOWN_KEYS.has(key)) {
      warn(`warning: unknown key '${key}' in ${result.filepath} (ignored)`);
    }
  }

  const known: SharedConfig = {};
  for (const key of SHARED_CONFIG_KEYS) {
    const value = (parsed.data as Record<string, unknown>)[key];
    if (value !== undefined) {
      (known as Record<string, unknown>)[key] = value;
    }
  }

  return { config: known, filepath: result.filepath };
}

function defaultWarn(message: string): void {
  process.stderr.write(`${message}\n`);
}

function describeType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function formatZodError(error: z.ZodError, filepath: string): string {
  const lines = error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '<root>';
    return `  - ${path}: ${issue.message}`;
  });
  return `invalid config at ${filepath}:\n${lines.join('\n')}`;
}
