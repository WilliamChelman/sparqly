import type {
  EndpointHttpFields,
  SourceSpecObjectInput,
  SparqlAuth,
} from './source-spec';

const ENDPOINT_ONLY_KEYS = ['auth', 'headers', 'timeoutMs'] as const;
const LEGACY_GRAPH_FIELD_KEYS = ['graphMode', 'graph'] as const;

export function rejectEndpointOnlyFields(input: SourceSpecObjectInput): void {
  for (const key of ENDPOINT_ONLY_KEYS) {
    if ((input as Record<string, unknown>)[key] !== undefined) {
      throw new Error(
        `\`${key}\` is only valid on endpoint sources (got a glob source)`,
      );
    }
  }
}

export function rejectLegacyEndpointGraphFields(
  input: SourceSpecObjectInput,
): void {
  for (const key of LEGACY_GRAPH_FIELD_KEYS) {
    if ((input as Record<string, unknown>)[key] !== undefined) {
      throw new Error(
        `\`${key}\` is not valid on endpoint sources; express endpoint graph behaviour through a view's query (see #78)`,
      );
    }
  }
}

export function pickEndpointHttp(
  input: SourceSpecObjectInput,
): EndpointHttpFields {
  const out: EndpointHttpFields = {};
  if (input.auth !== undefined) {
    out.auth = validateAuth(input.auth);
  }
  if (input.headers !== undefined) out.headers = { ...input.headers };
  if (input.timeoutMs !== undefined) out.timeoutMs = input.timeoutMs;
  if (out.auth && out.headers) {
    for (const key of Object.keys(out.headers)) {
      if (key.toLowerCase() === 'authorization') {
        throw new Error(
          '`auth` and an explicit `Authorization` header collide on the same endpoint source',
        );
      }
    }
  }
  return out;
}

function validateAuth(auth: SparqlAuth): SparqlAuth {
  if (auth.type === 'bearer') {
    if (typeof auth.token !== 'string' || auth.token.length === 0) {
      throw new Error('bearer auth `token` must be a non-empty string');
    }
    return { type: 'bearer', token: auth.token };
  }
  if (auth.type === 'basic') {
    if (typeof auth.username !== 'string' || auth.username.length === 0) {
      throw new Error('basic auth `username` must be a non-empty string');
    }
    if (typeof auth.password !== 'string' || auth.password.length === 0) {
      throw new Error('basic auth `password` must be a non-empty string');
    }
    return {
      type: 'basic',
      username: auth.username,
      password: auth.password,
    };
  }
  throw new Error(
    `unknown auth type: ${JSON.stringify((auth as { type: unknown }).type)}`,
  );
}
