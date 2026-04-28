import type { EnvBlock } from './env-config';
import type { ResolvedConfig } from './resolve-config';
import type {
  CommandName,
  EffectiveOptions,
  QueryBlockConfig,
  ServeBlockConfig,
} from './schema';

export interface ResolveEffectiveInput<C extends CommandName> {
  command: C;
  resolved: ResolvedConfig;
  env: EnvBlock<C>;
  cliOverrides: Partial<EffectiveOptions>;
  positionalSources?: string;
}

export function resolveEffective<C extends CommandName>(
  input: ResolveEffectiveInput<C>,
): EffectiveOptions {
  const block: QueryBlockConfig | ServeBlockConfig =
    input.command === 'query'
      ? input.resolved.queryBlock
      : input.resolved.serveBlock;

  const merged: Record<string, unknown> = {};
  assign(merged, input.resolved.shared);
  assign(merged, block);
  assign(merged, input.env);
  if (input.positionalSources !== undefined) {
    merged.sources = input.positionalSources;
  }
  assign(merged, input.cliOverrides);
  return merged as EffectiveOptions;
}

function assign(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): void {
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) target[key] = value;
  }
}
