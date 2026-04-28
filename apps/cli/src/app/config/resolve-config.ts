import { cosmiconfig, type CosmiconfigResult } from 'cosmiconfig';
import { z } from 'zod';
import {
  fileConfigSchema,
  QUERY_BLOCK_KEYS,
  SERVE_BLOCK_KEYS,
  SHARED_CONFIG_KEYS,
  type QueryBlockConfig,
  type ServeBlockConfig,
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
  shared: SharedConfig;
  queryBlock: QueryBlockConfig;
  serveBlock: ServeBlockConfig;
  filepath: string | null;
}

const SEARCH_PLACES = [
  'sparqly.config.yaml',
  'sparqly.config.yml',
  'sparqly.config.json',
];

const TOP_LEVEL_KNOWN: ReadonlySet<string> = new Set([
  ...SHARED_CONFIG_KEYS,
  'query',
  'serve',
]);
const QUERY_KNOWN: ReadonlySet<string> = new Set(QUERY_BLOCK_KEYS);
const SERVE_KNOWN: ReadonlySet<string> = new Set(SERVE_BLOCK_KEYS);

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
    return { shared: {}, queryBlock: {}, serveBlock: {}, filepath: null };
  }

  const raw = result.config;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ConfigError(
      `config at ${result.filepath} must be an object, got ${describeType(raw)}`,
    );
  }

  const parsed = fileConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ConfigError(formatZodError(parsed.error, result.filepath));
  }

  const warn = options.warn ?? defaultWarn;
  warnUnknownKeys(raw, TOP_LEVEL_KNOWN, result.filepath, warn);
  const queryRaw = (raw as Record<string, unknown>).query;
  if (queryRaw && typeof queryRaw === 'object' && !Array.isArray(queryRaw)) {
    warnUnknownKeys(
      queryRaw as Record<string, unknown>,
      QUERY_KNOWN,
      `${result.filepath} (query)`,
      warn,
    );
  }
  const serveRaw = (raw as Record<string, unknown>).serve;
  if (serveRaw && typeof serveRaw === 'object' && !Array.isArray(serveRaw)) {
    warnUnknownKeys(
      serveRaw as Record<string, unknown>,
      SERVE_KNOWN,
      `${result.filepath} (serve)`,
      warn,
    );
  }

  const data = parsed.data as Record<string, unknown>;
  const shared = pickKnown<SharedConfig>(data, SHARED_CONFIG_KEYS);
  const queryBlock = pickKnown<QueryBlockConfig>(
    (data.query as Record<string, unknown> | undefined) ?? {},
    QUERY_BLOCK_KEYS,
  );
  const serveBlock = pickKnown<ServeBlockConfig>(
    (data.serve as Record<string, unknown> | undefined) ?? {},
    SERVE_BLOCK_KEYS,
  );

  return { shared, queryBlock, serveBlock, filepath: result.filepath };
}

function pickKnown<T extends object>(
  source: Record<string, unknown>,
  keys: ReadonlyArray<string>,
): T {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined) out[key] = value;
  }
  return out as T;
}

function warnUnknownKeys(
  raw: Record<string, unknown>,
  known: ReadonlySet<string>,
  scope: string,
  warn: (message: string) => void,
): void {
  for (const key of Object.keys(raw)) {
    if (!known.has(key)) {
      warn(`warning: unknown key '${key}' in ${scope} (ignored)`);
    }
  }
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
