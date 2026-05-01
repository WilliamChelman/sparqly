import { readFile } from 'node:fs/promises';
import { extname, isAbsolute, resolve } from 'node:path';
import { load as loadYaml, YAMLException } from 'js-yaml';
import { z } from 'zod';
import type { CommandSpec } from './spec';
import { blockSchemaFromFields } from './field';
import type { FileLayers } from './runner';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function makeFileLoader(spec: CommandSpec) {
  return async (configPath: string, cwd: string): Promise<FileLayers> => {
    const absolute = isAbsolute(configPath) ? configPath : resolve(cwd, configPath);
    const raw = await readFileText(absolute);
    const parsed = parseByExtension(absolute, raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new ConfigError(
        `config at ${absolute} must be an object, got ${describeType(parsed)}`,
      );
    }
    const schema = strictBlockSchema(spec);
    const result = schema.safeParse(parsed);
    if (!result.success) {
      throw new ConfigError(formatZodError(result.error, absolute));
    }
    return { data: pickDefined(result.data as Record<string, unknown>), filepath: absolute };
  };
}

async function readFileText(absolute: string): Promise<string> {
  try {
    return await readFile(absolute, 'utf8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ConfigError(`failed to load --config '${absolute}': ${message}`);
  }
}

function parseByExtension(absolute: string, raw: string): unknown {
  const ext = extname(absolute).toLowerCase();
  if (ext === '.json') {
    try {
      return JSON.parse(raw);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new ConfigError(`failed to load --config '${absolute}': ${message}`);
    }
  }
  if (ext === '.yaml' || ext === '.yml' || ext === '') {
    try {
      return loadYaml(raw);
    } catch (err) {
      if (err instanceof YAMLException) {
        throw new ConfigError(`failed to load --config '${absolute}': ${err.message}`);
      }
      throw err;
    }
  }
  throw new ConfigError(
    `failed to load --config '${absolute}': unsupported extension '${ext}' (expected .yaml, .yml, or .json)`,
  );
}

function strictBlockSchema(spec: CommandSpec): z.ZodTypeAny {
  const base = blockSchemaFromFields(spec.fields);
  const refined = spec.refine ? spec.refine(base) : base;
  if (refined instanceof z.ZodObject) return refined.strict();
  return refined;
}

function pickDefined(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
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
