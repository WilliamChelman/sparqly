import { ClassicLevel } from 'classic-level';
import type { StoreOpts } from 'quadstore';

/**
 * Constructs the LevelDB backend for a disk-backed Glob index `Quadstore` at
 * `dbDir` (ADR-0041).
 *
 * `classic-level` and `quadstore` each depend on their own copy of
 * `abstract-level`, and those copies' `hooks` typings have drifted — so a
 * `ClassicLevel` is not *nominally* a `quadstore` `AbstractLevel` even though
 * it is one structurally and at runtime. This bridges that version skew in
 * exactly one documented place rather than scattering the cast across every
 * index open/build site.
 */
export function createGlobIndexBackend(dbDir: string): StoreOpts['backend'] {
  return new ClassicLevel(dbDir) as unknown as StoreOpts['backend'];
}
