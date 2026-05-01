import type { FieldDescriptor } from './field';
import { defaultsFromFields } from './field';

export type ConfigSource = 'default' | 'file' | 'env' | 'flag';

export interface Layers {
  readonly fileTop: Record<string, unknown>;
  readonly fileBlock: Record<string, unknown>;
  readonly env: Record<string, unknown>;
  readonly cli: Record<string, unknown>;
}

export interface MergeResult {
  readonly config: Record<string, unknown>;
  readonly sources: Record<string, ConfigSource>;
}

export function mergeLayers(
  fields: ReadonlyArray<FieldDescriptor>,
  layers: Layers,
): MergeResult {
  const ordered: ReadonlyArray<{ source: ConfigSource; layer: Record<string, unknown> }> =
    [
      { source: 'default', layer: defaultsFromFields(fields) },
      { source: 'file', layer: layers.fileTop },
      { source: 'file', layer: layers.fileBlock },
      { source: 'env', layer: layers.env },
      { source: 'flag', layer: layers.cli },
    ];

  const config: Record<string, unknown> = {};
  const sources: Record<string, ConfigSource> = {};
  for (const { source, layer } of ordered) {
    for (const [key, value] of Object.entries(layer)) {
      if (value === undefined) continue;
      config[key] = value;
      sources[key] = source;
    }
  }
  return { config, sources };
}
