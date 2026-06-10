import { parseHumanByteSize, parseHumanDuration } from 'common';
import type { ParsedQueryCache, SourceSpecObjectInput } from './source-spec';

/**
 * Resolves a source's `queryCache` opt-in (ADR-0054). `true`/`false` toggle it
 * under the global budget; the object form adds a per-source `maxBytes` cap
 * (a raw byte count, a human size like `256MB`, or `null` for explicitly
 * unbounded) and/or a per-source `ttl` (a human duration like `30min`, resolved
 * to milliseconds; ADR-0054 #416). An object with neither is a bare opt-in.
 */
export function pickQueryCache(input: SourceSpecObjectInput): {
  queryCache?: ParsedQueryCache;
} {
  const value = input.queryCache;
  if (value === undefined || value === false) return {};
  if (value === true) return { queryCache: true };
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(
      '`queryCache` must be a boolean or an object (`{ maxBytes, ttl }`)',
    );
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key !== 'maxBytes' && key !== 'ttl') {
      throw new Error(
        `unknown \`queryCache.${key}\` key (only \`maxBytes\` and \`ttl\`)`,
      );
    }
  }
  const resolved: { maxBytes?: number | null; ttl?: number } = {};
  if ('maxBytes' in record) {
    resolved.maxBytes = resolveMaxBytes(record['maxBytes']);
  }
  if ('ttl' in record) resolved.ttl = resolveTtlMs(record['ttl']);
  // An object with neither knob is just a bare opt-in.
  if (Object.keys(resolved).length === 0) return { queryCache: true };
  return { queryCache: resolved };
}

/** Resolves a per-source `maxBytes` to a byte count or `null` (unbounded). */
function resolveMaxBytes(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error('`queryCache.maxBytes` must be a positive byte count');
    }
    return value;
  }
  if (typeof value === 'string') {
    const bytes = parseHumanByteSize(value);
    if (bytes === undefined) {
      throw new Error(
        `\`queryCache.maxBytes\` is not a valid byte size: ${JSON.stringify(value)}`,
      );
    }
    return bytes;
  }
  throw new Error(
    '`queryCache.maxBytes` must be a byte count, a human size like `256MB`, or `null`',
  );
}

/** Resolves a per-source `ttl` to absolute milliseconds. */
function resolveTtlMs(value: unknown): number {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error('`queryCache.ttl` must be a positive duration');
    }
    return value;
  }
  if (typeof value === 'string') {
    const ms = parseHumanDuration(value);
    if (ms === undefined) {
      throw new Error(
        `\`queryCache.ttl\` is not a valid duration: ${JSON.stringify(value)}`,
      );
    }
    return ms;
  }
  throw new Error(
    '`queryCache.ttl` must be a human duration like `30min`, `1h`, or `30s`',
  );
}
