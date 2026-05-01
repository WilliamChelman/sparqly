import { cosmiconfig, type CosmiconfigResult } from 'cosmiconfig';
import { z } from 'zod';
import { ConfigError } from './errors';
import { COMMAND_REGISTRY } from '../../commands/registry';
import { blockSchemaFromFields } from '../../runner/field';

export interface LoadFileConfigOptions {
  cwd?: string;
  configPath?: string;
  stopDir?: string;
  warn?: (message: string) => void;
}

export interface FileConfigBlocks {
  readonly shared: Record<string, unknown>;
  readonly blocks: Record<string, Record<string, unknown>>;
  readonly filepath: string | null;
}

const SEARCH_PLACES = [
  'sparqly.config.yaml',
  'sparqly.config.yml',
  'sparqly.config.json',
];

interface BlockMeta {
  readonly fileBlockName: string;
  readonly knownKeys: ReadonlySet<string>;
  readonly schema: z.ZodTypeAny;
}

const BLOCK_METAS: ReadonlyArray<BlockMeta> = (() => {
  const out: BlockMeta[] = [];
  for (const spec of COMMAND_REGISTRY.values()) {
    out.push({
      fileBlockName: spec.fileBlockName ?? spec.name,
      knownKeys: new Set(spec.fields.map((f) => f.key)),
      schema: blockSchemaFromFields(spec.fields),
    });
  }
  return out;
})();

const SHARED_KEY_UNION: ReadonlySet<string> = (() => {
  const out = new Set<string>();
  for (const spec of COMMAND_REGISTRY.values()) {
    for (const f of spec.fields) {
      if (f.shared === true) out.add(f.key);
    }
  }
  return out;
})();

const TOP_LEVEL_KNOWN: ReadonlySet<string> = (() => {
  const out = new Set<string>(SHARED_KEY_UNION);
  for (const meta of BLOCK_METAS) out.add(meta.fileBlockName);
  return out;
})();

const fileConfigSchema = (() => {
  const sharedShape: Record<string, z.ZodTypeAny> = {};
  const seen = new Set<string>();
  for (const spec of COMMAND_REGISTRY.values()) {
    for (const f of spec.fields) {
      if (f.shared !== true) continue;
      if (seen.has(f.key)) continue;
      seen.add(f.key);
      sharedShape[f.key] = f.schema.optional();
    }
  }
  const blockShape: Record<string, z.ZodTypeAny> = {};
  for (const meta of BLOCK_METAS) {
    blockShape[meta.fileBlockName] = meta.schema.optional();
  }
  return z.object({ ...sharedShape, ...blockShape }).passthrough();
})();

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
    return { shared: {}, blocks: emptyBlocks(), filepath: null };
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
  warnUnknownKeys(
    raw as Record<string, unknown>,
    TOP_LEVEL_KNOWN,
    result.filepath,
    warn,
  );
  for (const meta of BLOCK_METAS) {
    const blockRaw = (raw as Record<string, unknown>)[meta.fileBlockName];
    if (blockRaw && typeof blockRaw === 'object' && !Array.isArray(blockRaw)) {
      warnUnknownKeys(
        blockRaw as Record<string, unknown>,
        meta.knownKeys,
        `${result.filepath} (${meta.fileBlockName})`,
        warn,
      );
    }
  }

  const data = parsed.data as Record<string, unknown>;
  const blocks: Record<string, Record<string, unknown>> = {};
  for (const meta of BLOCK_METAS) {
    blocks[meta.fileBlockName] = pickKnown(
      (data[meta.fileBlockName] as Record<string, unknown> | undefined) ?? {},
      meta.knownKeys,
    );
  }

  return {
    shared: pickKnown(data, SHARED_KEY_UNION),
    blocks,
    filepath: result.filepath,
  };
}

function emptyBlocks(): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const meta of BLOCK_METAS) out[meta.fileBlockName] = {};
  return out;
}

function pickKnown(
  source: Record<string, unknown>,
  keys: ReadonlySet<string>,
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
