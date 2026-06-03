/**
 * Extract the human-readable message from a failed `/api/describe` response
 * body. Since ADR-0052 describe targets one source, a failure is a typed
 * top-level error `{ kind, message, … }` (ADR-0024) carried in the HTTP error
 * body — the server formats the wording (single source of truth), the page
 * just renders it. Falls back to a generic string when the body is missing or
 * malformed so the page always has something for its single error banner.
 */
export function describeErrorMessage(errorBody: unknown): string {
  if (errorBody && typeof errorBody === 'object' && 'message' in errorBody) {
    const message = (errorBody as { message?: unknown }).message;
    if (typeof message === 'string' && message.length > 0) return message;
  }
  return 'describe request failed';
}
