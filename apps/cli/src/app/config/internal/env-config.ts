import type { ZodError } from 'zod';
import { ConfigError } from './errors';
import { blockSchemaFromFields } from '../../runner/field';
import type { CommandSpec } from '../../runner/spec';

export function readEnv(
  spec: CommandSpec,
  env: NodeJS.ProcessEnv,
): Record<string, unknown> {
  const raw: Record<string, unknown> = {};
  const sourceEnvName: Record<string, string> = {};

  for (const field of spec.fields) {
    if (field.env === undefined) continue;
    const names = typeof field.env === 'string' ? [field.env] : field.env;
    for (const name of names) {
      const value = env[name];
      if (value === undefined) continue;
      raw[field.key] = value;
      sourceEnvName[field.key] = name;
    }
  }

  const schema = blockSchemaFromFields(spec.fields);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ConfigError(formatEnvError(parsed.error, sourceEnvName));
  }

  const out: Record<string, unknown> = {};
  for (const field of spec.fields) {
    const value = (parsed.data as Record<string, unknown>)[field.key];
    if (value !== undefined) out[field.key] = value;
  }
  return out;
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
