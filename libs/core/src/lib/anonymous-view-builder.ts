import { Store } from 'n3';
import {
  parseSourceSpec,
  type ParsedSource,
  type ParsedViewSource,
  type SourceSpecInput,
} from './source-spec';
import { resolveView } from './view-resolver';

export interface AnonymousViewInput {
  source: SourceSpecInput;
  query?: string;
  queryFile?: string;
}

const ANON_UPSTREAM_ID = '__sparqly_anon_upstream__';
const ANON_VIEW_ID = '__sparqly_anon_view__';

export async function resolveAnonymousView(
  input: AnonymousViewInput,
): Promise<Store> {
  const hasQuery = input.query !== undefined;
  const hasQueryFile = input.queryFile !== undefined;
  if (hasQuery && hasQueryFile) {
    throw new Error(
      '`query` and `queryFile` are mutually exclusive on an anonymous view',
    );
  }
  if (!hasQuery && !hasQueryFile) {
    throw new Error(
      'an anonymous view requires exactly one of `query` or `queryFile`',
    );
  }

  const upstream = parseSourceSpec(input.source);
  if (upstream.kind === 'reference') {
    throw new Error(
      'anonymous view: `@id` reference upstreams are not supported here',
    );
  }
  const upstreamId = upstream.id ?? ANON_UPSTREAM_ID;
  const upstreamWithId: ParsedSource = { ...upstream, id: upstreamId };

  const view: ParsedViewSource = {
    kind: 'view',
    id: ANON_VIEW_ID,
    from: upstreamId,
    ...(hasQuery ? { query: input.query } : {}),
    ...(hasQueryFile ? { queryFile: input.queryFile } : {}),
  };

  return resolveView({ view, registry: [upstreamWithId, view] });
}
