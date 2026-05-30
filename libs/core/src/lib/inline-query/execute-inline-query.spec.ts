import { afterEach, describe, expect, it } from 'vitest';
import { parseSourceSpec, type ParsedSource } from '../sources';
import { recordingLogger } from '../test/recording-logger';
import {
  startFakeSparqlEndpoint,
  type FakeSparqlEndpoint,
} from '../test/fake-sparql-endpoint';
import { executeInlineQueryResult } from './execute-inline-query';

type InlineUpstream = Exclude<ParsedSource, { kind: 'reference' }>;

const SPO = 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }';

const EMPTY_RESULT = JSON.stringify({
  head: { vars: ['s', 'p', 'o'] },
  results: { bindings: [] },
});

describe('executeInlineQueryResult — query-log mode', () => {
  let endpoint: FakeSparqlEndpoint | undefined;

  afterEach(async () => {
    if (endpoint) await endpoint.close();
    endpoint = undefined;
  });

  it('logs the real resolution mode `materialized` for an in-memory upstream', async () => {
    const { logger, entries } = recordingLogger();
    const upstream = parseSourceSpec({ id: 'host', empty: true }) as InlineUpstream;

    const result = await executeInlineQueryResult(upstream, SPO, { logger });
    expect(result.isOk()).toBe(true);

    const event = entries.find((e) => e.msg === 'query');
    expect(event?.fields?.['mode']).toBe('materialized');
  });

  it('logs the real resolution mode `pass-through` for an endpoint upstream', async () => {
    endpoint = await startFakeSparqlEndpoint(() => ({ body: EMPTY_RESULT }));
    const { logger, entries } = recordingLogger();
    const upstream = parseSourceSpec({
      id: 'live',
      endpoint: endpoint.url,
    }) as InlineUpstream;

    const result = await executeInlineQueryResult(
      upstream,
      'SELECT ?s ?p ?o WHERE { ?s ?p ?o }',
      { logger },
    );
    expect(result.isOk()).toBe(true);

    const event = entries.find((e) => e.msg === 'query');
    expect(event?.fields?.['mode']).toBe('pass-through');
  });
});
