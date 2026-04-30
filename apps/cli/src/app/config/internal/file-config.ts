import { cosmiconfig, type CosmiconfigResult } from 'cosmiconfig';
import { z } from 'zod';
import { ConfigError } from './errors';
import {
  DIFF_BLOCK_KEYS,
  fileConfigSchema,
  HASH_BLOCK_KEYS,
  QUERY_BLOCK_KEYS,
  SERVE_BLOCK_KEYS,
  SHARED_KEYS,
} from './schema';

export interface LoadFileConfigOptions {
  cwd?: string;
  configPath?: string;
  stopDir?: string;
  warn?: (message: string) => void;
}

export interface FileConfigBlocks {
  shared: Record<string, unknown>;
  queryBlock: Record<string, unknown>;
  serveBlock: Record<string, unknown>;
  hashBlock: Record<string, unknown>;
  diffBlock: Record<string, unknown>;
  filepath: string | null;
}

const SEARCH_PLACES = [
  'sparqly.config.yaml',
  'sparqly.config.yml',
  'sparqly.config.json',
];

const TOP_LEVEL_KNOWN: ReadonlySet<string> = new Set([
  ...SHARED_KEYS,
  'query',
  'serve',
  'hash',
  'diff',
]);
const QUERY_KNOWN: ReadonlySet<string> = new Set(QUERY_BLOCK_KEYS);
const SERVE_KNOWN: ReadonlySet<string> = new Set(SERVE_BLOCK_KEYS);
const HASH_KNOWN: ReadonlySet<string> = new Set(HASH_BLOCK_KEYS);
const DIFF_KNOWN: ReadonlySet<string> = new Set(DIFF_BLOCK_KEYS);

export async function loadFileConfig(
  options: LoadFileConfigOptions = {},
): Promise<FileConfigBlocks> {
  const explorer = cosmiconfig('sparqly', {
    searchPlaces: SEARCH_PLACES,
    searchStrategy: 'global',
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
    return {
      shared: {},
      queryBlock: {},
      serveBlock: {},
      hashBlock: {},
      diffBlock: {},
      filepath: null,
    };
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
  const hashRaw = (raw as Record<string, unknown>).hash;
  if (hashRaw && typeof hashRaw === 'object' && !Array.isArray(hashRaw)) {
    warnUnknownKeys(
      hashRaw as Record<string, unknown>,
      HASH_KNOWN,
      `${result.filepath} (hash)`,
      warn,
    );
  }
  const diffRaw = (raw as Record<string, unknown>).diff;
  if (diffRaw && typeof diffRaw === 'object' && !Array.isArray(diffRaw)) {
    warnUnknownKeys(
      diffRaw as Record<string, unknown>,
      DIFF_KNOWN,
      `${result.filepath} (diff)`,
      warn,
    );
  }

  const data = parsed.data as Record<string, unknown>;
  return {
    shared: pickKnown(data, SHARED_KEYS),
    queryBlock: pickKnown(
      (data.query as Record<string, unknown> | undefined) ?? {},
      QUERY_BLOCK_KEYS,
    ),
    serveBlock: pickKnown(
      (data.serve as Record<string, unknown> | undefined) ?? {},
      SERVE_BLOCK_KEYS,
    ),
    hashBlock: pickKnown(
      (data.hash as Record<string, unknown> | undefined) ?? {},
      HASH_BLOCK_KEYS,
    ),
    diffBlock: pickKnown(
      (data.diff as Record<string, unknown> | undefined) ?? {},
      DIFF_BLOCK_KEYS,
    ),
    filepath: result.filepath,
  };
}

function pickKnown(
  source: Record<string, unknown>,
  keys: ReadonlyArray<string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
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
