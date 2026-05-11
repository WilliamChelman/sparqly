import type { ParsedEndpointSource } from '../source-spec';

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
  const ctx: ComunicaEndpointContext = {
    sources: [{ type: 'sparql', value: source.endpoint }],
    httpTimeout: timeoutMs,
  };
  if (Object.keys(injectedHeaders).length > 0) {
    const baseFetch: typeof fetch = globalThis.fetch.bind(globalThis);
    ctx.fetch = ((input, init) => {
      const merged = new Headers(init?.headers ?? undefined);
      for (const [k, v] of Object.entries(injectedHeaders)) merged.set(k, v);
      return baseFetch(input, { ...init, headers: merged });
    }) satisfies typeof fetch;
  }
  return ctx;
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
