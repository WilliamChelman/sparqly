import { ClassicLevel } from 'classic-level';
import type { StoreOpts } from 'quadstore';

// `classic-level` and `quadstore` each pull in their own `abstract-level`
// copy whose `hooks` typings have drifted, so `ClassicLevel` isn't nominally
// a `quadstore` `AbstractLevel` (it is structurally). One cast site beats
// scattering it across every index open/build.
export function createGlobIndexBackend(dbDir: string): StoreOpts['backend'] {
  return new ClassicLevel(dbDir) as unknown as StoreOpts['backend'];
}
