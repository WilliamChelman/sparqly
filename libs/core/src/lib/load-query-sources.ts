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

  const endpointsWithoutPrefilter = parsed.filter(
    (s) =>
      s.kind === 'endpoint' &&
      s.prefilter === undefined &&
      s.prefilterFile === undefined,
  );
  if (endpointsWithoutPrefilter.length > 0 && parsed.length > 1) {
    const first = endpointsWithoutPrefilter[0] as ParsedEndpointSource;
    throw new Error(
      `endpoint ${first.endpoint} has no prefilter and is mixed with other sources — endpoints without a prefilter must be the only source (add a prefilter to scope it, or remove the other sources)`,
    );
  }

  if (
    parsed.length === 1 &&
    parsed[0].kind === 'endpoint' &&
    parsed[0].prefilter === undefined &&
    parsed[0].prefilterFile === undefined
  ) {
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
