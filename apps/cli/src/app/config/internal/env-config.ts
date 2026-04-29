import type { ZodError } from 'zod';
import { ConfigError } from './errors';
import {
  blockKeysFor,
  blockSchemaFor,
  SHARED_KEYS,
  type CommandName,
} from './schema';

export function readEnv(
  command: CommandName,
  env: NodeJS.ProcessEnv,
): Record<string, unknown> {
  const blockKeys = blockKeysFor(command);
  const blockSchema = blockSchemaFor(command);
  const prefix = `SPARQLY_${command.toUpperCase()}_`;

  const raw: Record<string, unknown> = {};
  const sourceEnvName: Record<string, string> = {};

  for (const key of SHARED_KEYS) {
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
  return out;
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
