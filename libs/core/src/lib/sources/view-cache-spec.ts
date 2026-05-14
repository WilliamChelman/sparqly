export interface ParsedViewCacheTtl {
  strategy: 'ttl';
  ttlMs: number;
  cacheDir?: string;
}

export interface ParsedViewCacheFreshness {
  strategy: 'freshness';
  freshness: string;
  cacheDir?: string;
}

export interface ParsedViewCacheEverlasting {
  strategy: 'everlasting';
  cacheDir?: string;
}

export type ParsedViewCache =
  | ParsedViewCacheTtl
  | ParsedViewCacheFreshness
  | ParsedViewCacheEverlasting;

export interface ViewCacheInput {
  ttl?: string | number;
  freshness?: string;
  everlasting?: boolean;
  cacheDir?: string;
}

const KNOWN_CACHE_KEYS = new Set([
  'ttl',
  'freshness',
  'everlasting',
  'cacheDir',
]);

export function parseViewCache(
  viewId: string,
  raw: ViewCacheInput,
): ParsedViewCache {
  if (raw === null || typeof raw !== 'object') {
    throw new Error(
      `view "${viewId}": \`cache\` must be an object declaring exactly one of \`ttl\`, \`freshness\`, or \`everlasting\``,
    );
  }
  for (const key of Object.keys(raw)) {
    if (!KNOWN_CACHE_KEYS.has(key)) {
      throw new Error(
        `view "${viewId}": unknown \`cache\` key "${key}"`,
      );
    }
  }
  const declared: Array<'ttl' | 'freshness' | 'everlasting'> = [];
  if (raw.ttl !== undefined) declared.push('ttl');
  if (raw.freshness !== undefined) declared.push('freshness');
  if (raw.everlasting !== undefined) declared.push('everlasting');
  if (declared.length !== 1) {
    throw new Error(
      `view "${viewId}": \`cache\` must declare exactly one of \`ttl\`, \`freshness\`, or \`everlasting\` (got: ${
        declared.length === 0 ? '<none>' : declared.join(', ')
      })`,
    );
  }
  const cacheDir = parseCacheDir(viewId, raw.cacheDir);
  if (declared[0] === 'ttl') {
    const ttlMs = parseTtl(viewId, raw.ttl as string | number);
    return cacheDir === undefined
      ? { strategy: 'ttl', ttlMs }
      : { strategy: 'ttl', ttlMs, cacheDir };
  }
  if (declared[0] === 'freshness') {
    const freshness = raw.freshness as string;
    if (typeof freshness !== 'string' || freshness.trim().length === 0) {
      throw new Error(
        `view "${viewId}": \`cache.freshness\` must be a non-empty ASK query string`,
      );
    }
    return cacheDir === undefined
      ? { strategy: 'freshness', freshness }
      : { strategy: 'freshness', freshness, cacheDir };
  }
  if (raw.everlasting !== true) {
    throw new Error(
      `view "${viewId}": \`cache.everlasting\` must be \`true\` to opt into the everlasting strategy`,
    );
  }
  return cacheDir === undefined
    ? { strategy: 'everlasting' }
    : { strategy: 'everlasting', cacheDir };
}

function parseCacheDir(
  viewId: string,
  raw: string | undefined,
): string | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new Error(
      `view "${viewId}": \`cache.cacheDir\` must be a non-empty string`,
    );
  }
  return raw;
}

const TTL_PATTERN = /^(\d+)(ms|s|m|h|d)$/;
const TTL_UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

function parseTtl(viewId: string, raw: string | number): number {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw <= 0 || !Number.isInteger(raw)) {
      throw new Error(
        `view "${viewId}": \`cache.ttl\` numeric value must be a positive integer (ms)`,
      );
    }
    return raw;
  }
  if (typeof raw !== 'string') {
    throw new Error(
      `view "${viewId}": \`cache.ttl\` must be a duration string (e.g. "1h") or a positive integer (ms)`,
    );
  }
  const match = TTL_PATTERN.exec(raw.trim());
  if (!match) {
    throw new Error(
      `view "${viewId}": \`cache.ttl\` ${JSON.stringify(raw)} is not a valid duration (expected e.g. "100ms", "5s", "30m", "2h", "1d")`,
    );
  }
  const n = Number(match[1]);
  if (n <= 0) {
    throw new Error(
      `view "${viewId}": \`cache.ttl\` must be greater than zero`,
    );
  }
  return n * TTL_UNIT_MS[match[2]];
}
