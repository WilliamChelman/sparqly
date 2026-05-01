import { hashSpec } from './hash';
import type { CommandSpec } from '../runner/spec';

export const COMMAND_REGISTRY: ReadonlyMap<string, CommandSpec<never>> = new Map(
  [[hashSpec.name, hashSpec as unknown as CommandSpec<never>]],
);
