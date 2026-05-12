import { describe, expect, it } from 'vitest';
import {
  collapseWhitespace,
  formatLogLine,
  outcomeFields,
  truncateQueryText,
} from './log-format';

const TS = new Date('2026-05-12T08:09:07.123Z');
// Pin local time so HH:MM:SS.mmm is deterministic regardless of the host TZ.
const HH = String(TS.getHours()).padStart(2, '0');
const MM = String(TS.getMinutes()).padStart(2, '0');
const SS = String(TS.getSeconds()).padStart(2, '0');
const LOCAL_TIME = `${HH}:${MM}:${SS}.123`;

describe('formatLogLine — text', () => {
  it('renders HH:MM:SS.mmm LEVEL [ctx] msg key=val ...', () => {
    const line = formatLogLine('text', {
      ts: TS,
      level: 'debug',
      ctx: 'sparqly',
      msg: 'source-loaded',
      fields: { mode: 'materialized', files: 1, quads: 42 },
    });
    expect(line).toBe(
      `${LOCAL_TIME} DEBUG [sparqly] source-loaded mode=materialized files=1 quads=42`,
    );
  });

  it('omits the [ctx] segment when no context is given', () => {
    const line = formatLogLine('text', { ts: TS, level: 'info', msg: 'hello' });
    expect(line).toBe(`${LOCAL_TIME} INFO hello`);
  });

  it('JSON-encodes field values that contain whitespace', () => {
    const line = formatLogLine('text', {
      ts: TS,
      level: 'error',
      msg: 'query',
      fields: { query: 'SELECT * WHERE { ?s ?p ?o }' },
    });
    expect(line).toBe(
      `${LOCAL_TIME} ERROR query query="SELECT * WHERE { ?s ?p ?o }"`,
    );
  });
});

describe('formatLogLine — json', () => {
  it('renders one {ts, level, ctx, msg, ...fields} object', () => {
    const line = formatLogLine('json', {
      ts: TS,
      level: 'debug',
      ctx: 'sparqly',
      msg: 'source-loaded',
      fields: { mode: 'materialized', ms: 3 },
    });
    expect(JSON.parse(line)).toEqual({
      ts: '2026-05-12T08:09:07.123Z',
      level: 'debug',
      ctx: 'sparqly',
      msg: 'source-loaded',
      mode: 'materialized',
      ms: 3,
    });
    expect(line).not.toContain('\n');
  });

  it('omits ctx when not provided', () => {
    const line = formatLogLine('json', { ts: TS, level: 'warn', msg: 'heads up' });
    expect(JSON.parse(line)).toEqual({
      ts: '2026-05-12T08:09:07.123Z',
      level: 'warn',
      msg: 'heads up',
    });
  });
});

describe('query-text helpers', () => {
  it('collapses runs of whitespace (incl. newlines) to single spaces and trims', () => {
    expect(collapseWhitespace('  SELECT *\n  WHERE  {\n\t?s ?p ?o\n}  ')).toBe(
      'SELECT * WHERE { ?s ?p ?o }',
    );
  });

  it('truncates long query text with an ellipsis after collapsing whitespace', () => {
    const long = 'SELECT ' + 'a'.repeat(500);
    const out = truncateQueryText(long, 20);
    expect(out).toBe('SELECT aaaaaaaaaaaaa…');
    expect(out.length).toBe(21);
  });

  it('leaves short query text untouched', () => {
    expect(truncateQueryText('ASK { ?s ?p ?o }', 200)).toBe('ASK { ?s ?p ?o }');
  });
});

describe('outcomeFields', () => {
  it('reports ok when no error is given', () => {
    expect(outcomeFields()).toEqual({ outcome: 'ok' });
  });

  it('reports error with the message for an Error', () => {
    expect(outcomeFields(new Error('boom'))).toEqual({
      outcome: 'error',
      error: 'boom',
    });
  });

  it('stringifies non-Error throwables', () => {
    expect(outcomeFields('nope')).toEqual({ outcome: 'error', error: 'nope' });
  });
});
