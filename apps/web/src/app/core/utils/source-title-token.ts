/**
 * Render a source picker value as a compact title token: a pinned address
 * `@id:ref` becomes `id@ref`, a plain id passes through. Self-contained
 * parsing — mirrors the picker's private `splitPinnedAddress` (ADR-0053).
 */
export function sourceTitleToken(value: string): string {
  if (!value.startsWith('@')) return value;
  const body = value.slice(1);
  const lastColon = body.lastIndexOf(':');
  if (lastColon === -1) return body;
  const id = body.slice(0, lastColon);
  const ref = body.slice(lastColon + 1);
  if (id.length === 0 || ref.length === 0) return body;
  return `${id}@${ref}`;
}
