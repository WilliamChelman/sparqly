import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { mergeLayers, type Layers } from './merge';
import type { FieldDescriptor } from './field';

const verbose: FieldDescriptor = {
  key: 'verbose',
  schema: z.boolean(),
  default: false,
};
const sources: FieldDescriptor = {
  key: 'sources',
  schema: z.string(),
};
const port: FieldDescriptor = {
  key: 'port',
  schema: z.number().int(),
  default: 3000,
};

describe('mergeLayers', () => {
  it('applies defaults when no other layer sets a key', () => {
    const layers: Layers = { fileTop: {}, fileBlock: {}, env: {}, cli: {} };
    const out = mergeLayers([verbose, sources, port], layers);
    expect(out.config).toEqual({ verbose: false, port: 3000 });
    expect(out.sources.verbose).toBe('default');
    expect(out.sources.port).toBe('default');
  });

  it('cli wins over env, env over file-block, file-block over file-top, file-top over default', () => {
    const out = mergeLayers([verbose, sources, port], {
      fileTop: { verbose: true, port: 8080, sources: 'top/*.ttl' },
      fileBlock: { port: 9000, sources: 'block/*.ttl' },
      env: { sources: 'env/*.ttl' },
      cli: {},
    });
    expect(out.config).toEqual({
      verbose: true,
      port: 9000,
      sources: 'env/*.ttl',
    });
    expect(out.sources).toEqual({
      verbose: 'file',
      port: 'file',
      sources: 'env',
    });
  });

  it('cli overrides everything', () => {
    const out = mergeLayers([verbose, sources, port], {
      fileTop: {},
      fileBlock: { port: 9000 },
      env: { port: 7000 },
      cli: { port: 5000 },
    });
    expect(out.config.port).toBe(5000);
    expect(out.sources.port).toBe('flag');
  });

  it('skips undefined values from any layer', () => {
    const out = mergeLayers([sources], {
      fileTop: {},
      fileBlock: {},
      env: { sources: undefined as unknown as string },
      cli: { sources: 'a/*.ttl' },
    });
    expect(out.config.sources).toBe('a/*.ttl');
    expect(out.sources.sources).toBe('flag');
  });
});
