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
 * Comunica (via fetch-sparql-endpoint) submits queries as
 * `application/x-www-form-urlencoded` POST bodies (`query=…`) unless the
 * endpoint's service description opts into direct POST. Some endpoints —
 * notably Fedlex's Virtuoso behind its reverse proxy — cap the `query`
 * form parameter at ~600 bytes and answer longer queries with an HTML 400
 * page. Rewriting the request to a SPARQL 1.1 Protocol direct POST
 * (`Content-Type: application/sparql-query`, raw query as the body) sidesteps
 * that limit and is universally supported.
 */
function preferDirectPost(
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
): { input: Parameters<typeof fetch>[0]; init: Parameters<typeof fetch>[1] } {
  if (!init || init.method?.toUpperCase() !== 'POST' || !init.body) {
    return { input, init };
  }
  const contentType = new Headers(init.headers ?? undefined).get(
    'content-type',
  );
  if (!contentType?.toLowerCase().includes('application/x-www-form-urlencoded')) {
    return { input, init };
  }
  if (typeof input !== 'string' && !(input instanceof URL)) {
    return { input, init };
  }
  const params =
    init.body instanceof URLSearchParams
      ? init.body
      : typeof init.body === 'string'
        ? new URLSearchParams(init.body)
        : undefined;
  const query = params?.get('query');
  if (!params || query === null || query === undefined) {
    return { input, init };
  }

  const url = new URL(typeof input === 'string' ? input : input.href);
  for (const [k, v] of params) {
    if (k !== 'query') url.searchParams.append(k, v);
  }
  const headers = new Headers(init.headers ?? undefined);
  headers.set('Content-Type', 'application/sparql-query');
  headers.delete('Content-Length');
  return {
    input: url.toString(),
    init: { ...init, body: query, headers },
  };
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
