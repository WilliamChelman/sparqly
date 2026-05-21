import type { ParsedEndpointSource } from '../sources';

export const DEFAULT_ENDPOINT_TIMEOUT_MS = 30000;

export interface ComunicaEndpointContext {
  sources: Array<{ type: 'sparql'; value: string }>;
  httpTimeout: number;
  fetch?: typeof fetch;
}

export function buildEndpointContext(
  source: ParsedEndpointSource,
): ComunicaEndpointContext {
  const timeoutMs = source.timeoutMs ?? DEFAULT_ENDPOINT_TIMEOUT_MS;
  const injectedHeaders = collectInjectedHeaders(source);
  const baseFetch: typeof fetch = globalThis.fetch.bind(globalThis);
  return {
    sources: [{ type: 'sparql', value: source.endpoint }],
    httpTimeout: timeoutMs,
    fetch: ((input, init) => {
      const rewritten = preferDirectPost(input, init);
      const headers = new Headers(rewritten.init?.headers ?? undefined);
      for (const [k, v] of Object.entries(injectedHeaders)) headers.set(k, v);
      return baseFetch(rewritten.input, { ...rewritten.init, headers });
    }) satisfies typeof fetch,
  };
}

/**
 * Comunica (via fetch-sparql-endpoint) submits a query either as a
 * `GET ?query=…` request (short queries) or as an
 * `application/x-www-form-urlencoded` POST body (`query=…`, longer queries),
 * unless the endpoint's service description opts into direct POST. Both
 * shapes break on real-world endpoints: Fedlex's Virtuoso caps the `query`
 * form parameter at ~600 bytes and answers longer queries with an HTML 400
 * page, while ERA's RINF endpoint answers `GET ?query=` with an HTTP 500.
 * Rewriting either shape to a SPARQL 1.1 Protocol direct POST
 * (`Content-Type: application/sparql-query`, raw query as the body) sidesteps
 * both and is universally supported.
 */
function preferDirectPost(
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
): { input: Parameters<typeof fetch>[0]; init: Parameters<typeof fetch>[1] } {
  const forwarded = extractForwardedQuery(input, init);
  if (!forwarded) {
    return { input, init };
  }
  const headers = new Headers(init?.headers ?? undefined);
  headers.set('Content-Type', 'application/sparql-query');
  headers.delete('Content-Length');
  return {
    input: forwarded.url.toString(),
    init: { ...init, method: 'POST', body: forwarded.query, headers },
  };
}

/**
 * Recognizes a SPARQL `query` request in either wire shape Comunica emits —
 * `GET ?query=…` or a form-urlencoded POST body — and returns the bare query
 * string plus the endpoint URL stripped of the `query` parameter (other
 * parameters are preserved). Returns `undefined` for any other request
 * (an already-direct POST, a hypermedia GET without `query`, an update).
 */
function extractForwardedQuery(
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
): { url: URL; query: string } | undefined {
  if (typeof input !== 'string' && !(input instanceof URL)) {
    return undefined;
  }
  const url = new URL(typeof input === 'string' ? input : input.href);
  const method = init?.method?.toUpperCase() ?? 'GET';

  if (method === 'GET') {
    const query = url.searchParams.get('query');
    if (query === null) return undefined;
    url.searchParams.delete('query');
    return { url, query };
  }

  if (method !== 'POST' || !init?.body) {
    return undefined;
  }
  const contentType = new Headers(init.headers ?? undefined).get(
    'content-type',
  );
  if (!contentType?.toLowerCase().includes('application/x-www-form-urlencoded')) {
    return undefined;
  }
  const params =
    init.body instanceof URLSearchParams
      ? init.body
      : typeof init.body === 'string'
        ? new URLSearchParams(init.body)
        : undefined;
  const query = params?.get('query');
  if (!params || query === null || query === undefined) {
    return undefined;
  }
  for (const [k, v] of params) {
    if (k !== 'query') url.searchParams.append(k, v);
  }
  return { url, query };
}

export function collectInjectedHeaders(
  source: ParsedEndpointSource,
): Record<string, string> {
  const headers: Record<string, string> = {};
  if (source.headers) {
    for (const [k, v] of Object.entries(source.headers)) headers[k] = v;
  }
  if (source.auth) {
    if (source.auth.type === 'bearer') {
      headers['Authorization'] = `Bearer ${source.auth.token}`;
    } else {
      const token = Buffer.from(
        `${source.auth.username}:${source.auth.password}`,
        'utf8',
      ).toString('base64');
      headers['Authorization'] = `Basic ${token}`;
    }
  }
  return headers;
}

export function describeEndpointError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
