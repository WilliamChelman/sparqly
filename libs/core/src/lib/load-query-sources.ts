import type { Store } from 'n3';
import {
  loadSources,
  type LoadSourcesOptions,
} from './load-sources';
import {
  parseSourceSpecs,
  type ParsedEndpointSource,
  type SourceSpecInput,
} from './source-spec';

export type QuerySources =
  | { mode: 'pass-through'; endpoint: ParsedEndpointSource }
  | {
      mode: 'materialized';
      store: Store;
      files: string[];
      prefixes: Record<string, Record<string, string>>;
    };

export async function loadQuerySources(
  inputs: ReadonlyArray<SourceSpecInput>,
  options: LoadSourcesOptions = {},
): Promise<QuerySources> {
  const parsed = parseSourceSpecs(inputs, options.parseContext);

  if (parsed.length === 1 && parsed[0].kind === 'endpoint') {
    return { mode: 'pass-through', endpoint: parsed[0] };
  }

  const loaded = await loadSources(inputs, options);
  return {
    mode: 'materialized',
    store: loaded.store,
    files: loaded.files,
    prefixes: loaded.prefixes,
  };
}
