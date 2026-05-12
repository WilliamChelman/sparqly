import type { SparqlyLogFields, SparqlyLogLevel } from './sparqly-logger';

export type LogFormat = 'text' | 'json';

export interface LogEntry {
  ts: Date;
  level: SparqlyLogLevel;
  ctx?: string;
  msg: string;
  fields?: SparqlyLogFields;
}

/** Max characters kept from a query-text field before truncation. */
export const DEFAULT_QUERY_TEXT_LIMIT = 200;

export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function truncateQueryText(
  text: string,
  limit: number = DEFAULT_QUERY_TEXT_LIMIT,
): string {
  const collapsed = collapseWhitespace(text);
  if (collapsed.length <= limit) return collapsed;
  return `${collapsed.slice(0, limit)}…`;
}

/**
 * Stable `{ outcome, error? }` shape for boundary log lines: `outcome: 'ok'`
 * when nothing threw, `outcome: 'error'` plus the message otherwise.
 */
export function outcomeFields(err?: unknown): SparqlyLogFields {
  if (err === undefined) return { outcome: 'ok' };
  const error = err instanceof Error ? err.message : String(err);
  return { outcome: 'error', error };
}

export function formatLogLine(format: LogFormat, entry: LogEntry): string {
  return format === 'json' ? toJsonLine(entry) : toTextLine(entry);
}

function toTextLine(entry: LogEntry): string {
  const parts = [
    localTime(entry.ts),
    entry.level.toUpperCase(),
    ...(entry.ctx ? [`[${entry.ctx}]`] : []),
    entry.msg,
  ];
  for (const [key, value] of Object.entries(entry.fields ?? {})) {
    parts.push(`${key}=${renderTextValue(value)}`);
  }
  return parts.join(' ');
}

function toJsonLine(entry: LogEntry): string {
  return JSON.stringify({
    ts: entry.ts.toISOString(),
    level: entry.level,
    ...(entry.ctx ? { ctx: entry.ctx } : {}),
    msg: entry.msg,
    ...(entry.fields ?? {}),
  });
}

function renderTextValue(value: unknown): string {
  if (typeof value === 'string') {
    return /\s/.test(value) ? JSON.stringify(value) : value;
  }
  if (value !== null && typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function localTime(ts: Date): string {
  const p2 = (n: number) => String(n).padStart(2, '0');
  const p3 = (n: number) => String(n).padStart(3, '0');
  return `${p2(ts.getHours())}:${p2(ts.getMinutes())}:${p2(ts.getSeconds())}.${p3(ts.getMilliseconds())}`;
}
