export interface SubstituteSourceEnvOptions {
  env: Record<string, string | undefined>;
}

export function substituteSourceEnv(
  sources: unknown[],
  options: SubstituteSourceEnvOptions,
): unknown[] {
  return sources.map((entry, i) =>
    walk(entry, options.env, `/sources/${i}`),
  );
}

function walk(
  value: unknown,
  env: Record<string, string | undefined>,
  pointer: string,
): unknown {
  if (typeof value === 'string') return expandString(value, env, pointer);
  if (Array.isArray(value)) {
    return value.map((v, i) => walk(v, env, `${pointer}/${i}`));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = walk(v, env, `${pointer}/${escapeJsonPointer(k)}`);
    }
    return out;
  }
  return value;
}

function escapeJsonPointer(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1');
}

function expandString(
  s: string,
  env: Record<string, string | undefined>,
  pointer: string,
): string {
  let out = '';
  let i = 0;
  while (i < s.length) {
    if (s[i] === '$' && s[i + 1] === '$' && s[i + 2] === '{') {
      const close = s.indexOf('}', i + 3);
      if (close === -1) {
        throw new Error(
          `unclosed \`$\${\` in source-spec string at ${pointer}`,
        );
      }
      const inner = s.slice(i + 3, close);
      out += `\${${inner}}`;
      i = close + 1;
      continue;
    }
    if (s[i] === '$' && s[i + 1] === '{') {
      const close = s.indexOf('}', i + 2);
      if (close === -1) {
        throw new Error(
          `unclosed \`\${\` in source-spec string at ${pointer}`,
        );
      }
      const name = s.slice(i + 2, close);
      const value = env[name];
      if (value === undefined) {
        throw new Error(
          `missing env var \`${name}\` referenced at ${pointer}`,
        );
      }
      if (value === '') {
        throw new Error(
          `env var \`${name}\` is empty (referenced at ${pointer})`,
        );
      }
      out += value;
      i = close + 1;
      continue;
    }
    out += s[i];
    i++;
  }
  return out;
}
