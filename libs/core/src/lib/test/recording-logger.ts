import type { SparqlyLogFields, SparqlyLogger } from 'common';

export interface RecordedLog {
  level: 'debug' | 'info' | 'warn' | 'error';
  msg: string;
  fields?: SparqlyLogFields;
}

/** A {@link SparqlyLogger} that captures every call into `entries` for tests. */
export function recordingLogger(): {
  logger: SparqlyLogger;
  entries: RecordedLog[];
} {
  const entries: RecordedLog[] = [];
  const record =
    (level: RecordedLog['level']) =>
    (msg: string, fields?: SparqlyLogFields): void => {
      entries.push({ level, msg, fields });
    };
  return {
    entries,
    logger: {
      debug: record('debug'),
      info: record('info'),
      warn: record('warn'),
      error: record('error'),
    },
  };
}
