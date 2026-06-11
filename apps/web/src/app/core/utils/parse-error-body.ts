export function parseErrorBody(body: unknown): string | undefined {
  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body) as { message?: string };
      if (parsed && typeof parsed.message === 'string') return parsed.message;
    } catch {
      return body || undefined;
    }
    return body || undefined;
  }
  if (body && typeof body === 'object' && 'message' in body) {
    const msg = (body as { message?: unknown }).message;
    if (typeof msg === 'string') return msg;
  }
  return undefined;
}
