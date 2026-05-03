import {
  loadSources,
  type LoadSourcesOptions,
} from './load-sources';
import { type QuerySources } from './resolve-source';
import {
  parseSourceSpecs,
  type SourceSpecInput,
} from './source-spec';

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
