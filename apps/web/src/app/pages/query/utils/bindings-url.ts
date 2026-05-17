import type { ParamMap } from '@angular/router';
import type { ParameterBindings } from 'common';

const PREFIX = 'bind.';

export function parseBindings(params: ParamMap): ParameterBindings | null {
  const out: Record<string, string | string[]> = {};
  for (const key of params.keys) {
    if (!key.startsWith(PREFIX)) continue;
    const name = key.slice(PREFIX.length);
    const values = params.getAll(key);
    if (values.length > 1) out[name] = values;
    else if (values.length === 1) out[name] = values[0];
  }
  return Object.keys(out).length === 0 ? null : out;
}

export function encodeBindings(
  bindings: ParameterBindings,
): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(bindings)) {
    out[`${PREFIX}${name}`] = Array.isArray(value)
      ? value.map(scalarToString)
      : scalarToString(value);
  }
  return out;
}

function scalarToString(value: unknown): string {
  if (value && typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
