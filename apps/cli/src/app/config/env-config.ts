import type { ZodError } from 'zod';
import { ConfigError } from './resolve-config';
import {
  QUERY_BLOCK_KEYS,
  queryBlockSchema,
  SERVE_BLOCK_KEYS,
  serveBlockSchema,
  SHARED_CONFIG_KEYS,
  type CommandName,
  type QueryBlockConfig,
  type ServeBlockConfig,
} from './schema';

export type EnvBlock<C extends CommandName> = C extends 'query'
  ? QueryBlockConfig
  : ServeBlockConfig;

export function readEnv<C extends CommandName>(
  command: C,
  env: NodeJS.ProcessEnv,
): EnvBlock<C> {
  const blockKeys =
    command === 'query' ? QUERY_BLOCK_KEYS : SERVE_BLOCK_KEYS;
  const blockSchema = command === 'query' ? queryBlockSchema : serveBlockSchema;
  const prefix = command === 'query' ? 'SPARQLY_QUERY_' : 'SPARQLY_SERVE_';

  const raw: Record<string, unknown> = {};
  const sourceEnvName: Record<string, string> = {};

  for (const key of SHARED_CONFIG_KEYS) {
    const envName = `SPARQLY_${toUpperSnake(key)}`;
    if (env[envName] !== undefined) {
      raw[key] = env[envName];
      sourceEnvName[key] = envName;
    }
  }

  for (const key of blockKeys) {
    const envName = `${prefix}${toUpperSnake(key)}`;
    if (env[envName] !== undefined) {
      raw[key] = env[envName];
      sourceEnvName[key] = envName;
    }
  }

  const parsed = blockSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ConfigError(formatEnvError(parsed.error, sourceEnvName));
  }

  const out: Record<string, unknown> = {};
  for (const key of blockKeys) {
    const value = (parsed.data as Record<string, unknown>)[key];
    if (value !== undefined) out[key] = value;
  }
  return out as EnvBlock<C>;
}

function toUpperSnake(camel: string): string {
  return camel.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase();
}

function formatEnvError(
  error: ZodError,
  sourceEnvName: Record<string, string>,
): string {
  const lines = error.issues.map((issue) => {
    const key = issue.path.length > 0 ? String(issue.path[0]) : '<root>';
    const envName = sourceEnvName[key] ?? key;
    return `  - ${envName}: ${issue.message}`;
  });
  return `invalid environment variables:\n${lines.join('\n')}`;
}
