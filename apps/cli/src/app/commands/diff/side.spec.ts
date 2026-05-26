import { describe, expect, it, vi } from 'vitest';
import type { ParsedSource } from 'core';
import { resolveSide } from './side';

function captureLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

const endpoint = (id: string, url: string): ParsedSource => ({
  kind: 'endpoint',
  id,
  endpoint: url,
});

const view = (id: string, from: string): ParsedSource => ({
  kind: 'view',
  id,
  from,
  query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
});

describe('resolveSide — pass-through boundary warn (ADR-0047, #376)', () => {
  it('emits one warn-level boundary log per pass-through-resolved side, naming the source and the suppressed Source-file snippet consequence', async () => {
    const registry: ParsedSource[] = [
      endpoint('live', 'https://unreachable.invalid/sparql'),
      view('v', 'live'),
    ];
    const logger = captureLogger();

    // Resolution will fail because the endpoint is unreachable; the warn is
    // emitted at the boundary before resolution runs, so the assertion is
    // unaffected by the throw.
    await resolveSide(registry[1], {}, undefined, 'left', logger, registry).catch(
      () => undefined,
    );

    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [msg, fields] = logger.warn.mock.calls[0];
    expect(msg).toContain('https://unreachable.invalid/sparql');
    expect(msg).toMatch(/source.?file snippet/i);
    expect(fields).toMatchObject({ side: 'left' });
  });

  it('names a disk-backed glob upstream by its `@id` label', async () => {
    const registry: ParsedSource[] = [
      { kind: 'glob', id: 'big', glob: 'huge/**/*.ttl', storage: 'disk' },
      view('v', 'big'),
    ];
    const logger = captureLogger();

    await resolveSide(registry[1], {}, undefined, 'right', logger, registry).catch(
      () => undefined,
    );

    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [msg] = logger.warn.mock.calls[0];
    expect(msg).toContain('@big');
    expect(msg).toMatch(/source.?file snippet/i);
  });

  it('emits zero pass-through boundary warns when the side is not pass-through-resolved (in-memory glob, no match)', async () => {
    const registry: ParsedSource[] = [
      { kind: 'glob', id: 'local', glob: 'no/such/match-*.ttl' },
    ];
    const logger = captureLogger();

    await resolveSide(registry[0], {}, undefined, 'left', logger, registry).catch(
      () => undefined,
    );

    // The glob no-match path emits its own warn (ADR-0028) — assert no warn
    // mentions Source-file snippet / pass-through boundary specifically.
    const boundaryWarns = logger.warn.mock.calls.filter(([msg]) =>
      /source.?file snippet/i.test(String(msg)),
    );
    expect(boundaryWarns).toEqual([]);
  });

  it('emits zero warns when an inline query is provided (anonymous-view path bypasses the pass-through chain check)', async () => {
    const target: ParsedSource = {
      kind: 'endpoint',
      id: 'live',
      endpoint: 'https://unreachable.invalid/sparql',
    };
    const logger = captureLogger();

    await resolveSide(
      target,
      {},
      'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      'left',
      logger,
      [target],
    ).catch(() => undefined);

    expect(logger.warn).not.toHaveBeenCalled();
  });
});
