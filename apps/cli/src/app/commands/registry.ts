import { cacheClearSpec, cacheListSpec } from './cache';
import { diffSpec } from './diff/diff';
import { formatSpec } from './format';
import { hashSpec } from './hash';
import { initSpec } from './init/init';
import { querySpec } from './query';
import { serveSpec } from './serve';
import type { CommandSpec } from '../runner/fields/spec';

const ALL_SPECS: ReadonlyArray<CommandSpec<never>> = [
  cacheListSpec as unknown as CommandSpec<never>,
  cacheClearSpec as unknown as CommandSpec<never>,
  diffSpec as unknown as CommandSpec<never>,
  formatSpec as unknown as CommandSpec<never>,
  hashSpec as unknown as CommandSpec<never>,
  initSpec as unknown as CommandSpec<never>,
  querySpec as unknown as CommandSpec<never>,
  serveSpec as unknown as CommandSpec<never>,
];

export const COMMAND_REGISTRY: ReadonlyMap<string, CommandSpec<never>> =
  new Map(ALL_SPECS.map((spec) => [spec.name, spec]));
