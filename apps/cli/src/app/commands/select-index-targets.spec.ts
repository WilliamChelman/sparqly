import { describe, expect, it } from 'vitest';
import type {
  ParsedEndpointSource,
  ParsedGlobSource,
  ParsedSource,
} from 'core';
import { selectIndexTargets } from './select-index-targets';

const DISK_GLOB: ParsedGlobSource = {
  kind: 'glob',
  id: 'big',
  glob: 'data/*.ttl',
  storage: 'disk',
};
const MEMORY_GLOB: ParsedGlobSource = {
  kind: 'glob',
  id: 'small',
  glob: 'other/*.ttl',
};
const ENDPOINT: ParsedEndpointSource = {
  kind: 'endpoint',
  id: 'people',
  endpoint: 'https://example.org/sparql',
};

/**
 * Coverage for {@link selectIndexTargets} (#346): the `sparqly index` selector
 * that turns the expanded source registry plus the command's positional `@id`
 * args into the disk-backed sources to build.
 */
describe('selectIndexTargets', () => {
  it('with no ids, returns every disk-backed source and skips the rest', () => {
    const registry: ParsedSource[] = [DISK_GLOB, MEMORY_GLOB, ENDPOINT];
    expect(selectIndexTargets(registry, [])).toEqual([DISK_GLOB]);
  });

  it('selects only the named disk-backed sources when ids are given', () => {
    const other: ParsedGlobSource = {
      kind: 'glob',
      id: 'archive',
      glob: 'more/*.ttl',
      storage: 'disk',
    };
    const registry: ParsedSource[] = [DISK_GLOB, other, MEMORY_GLOB];
    expect(selectIndexTargets(registry, ['@big'])).toEqual([DISK_GLOB]);
  });

  it('rejects an explicit id that is not a disk-backed source', () => {
    const registry: ParsedSource[] = [DISK_GLOB, MEMORY_GLOB, ENDPOINT];
    expect(() => selectIndexTargets(registry, ['@small'])).toThrow(
      /@small.*storage: disk/,
    );
    expect(() => selectIndexTargets(registry, ['@people'])).toThrow(
      /@people.*storage: disk/,
    );
  });

  it('rejects an id that names no registry source', () => {
    const registry: ParsedSource[] = [DISK_GLOB, MEMORY_GLOB];
    expect(() => selectIndexTargets(registry, ['@missing'])).toThrow(
      /unknown source @missing/,
    );
  });
});
