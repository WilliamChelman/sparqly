import { Store } from 'n3';
import type { SparqlyLogger } from 'common';
import {
  parseSourceSpec,
  type ParsedSource,
  type ParsedViewSource,
  type SourceSpecInput,
} from '../sources';
import { resolveView } from './view-resolver';

export interface AnonymousViewInput {
  source: SourceSpecInput;
  query?: string;
  queryFile?: string;
  /** Forwarded to view resolution so the SPARQL run emits a `query` event. */
  logger?: SparqlyLogger;
}

const ANON_UPSTREAM_ID = '__sparqly_anon_upstream__';
const ANON_VIEW_ID = '__sparqly_anon_view__';

function anonViewLabel(upstream: ParsedSource): string {
  const label =
    upstream.kind === 'glob'
      ? upstream.glob
      : upstream.kind === 'endpoint'
        ? upstream.endpoint
        : (upstream.id ?? ANON_VIEW_ID);
  // Keep the synthetic view id distinct from its upstream's so cycle
  // detection on the `from:` chain never false-positives.
  return label === (upstream.id ?? ANON_UPSTREAM_ID) ? ANON_VIEW_ID : label;
}

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
    id: anonViewLabel(upstream),
    from: upstreamId,
    ...(hasQuery ? { query: input.query } : {}),
    ...(hasQueryFile ? { queryFile: input.queryFile } : {}),
  };

  return resolveView({
    view,
    registry: [upstreamWithId, view],
    logger: input.logger,
  });
}
