export type DescribeIriExpandResult =
  | { ok: true; iri: string }
  | { ok: false; error: string };

const ABSOLUTE_IRI = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;
const PREFIXED_NAME = /^([A-Za-z_][\w.-]*)?:(.*)$/s;

/**
 * Expand a user-supplied describe seed into a fully-qualified IRI.
 *
 * Accepts three input forms:
 *  - `<http://example.org/alice>` — bracketed IRI; brackets are stripped.
 *  - `http://example.org/alice` — bare absolute IRI; passed through.
 *  - `ex:alice` — prefixed name; expanded against `prefixes`.
 *
 * An unknown prefix is a hard error — it is never silently re-interpreted as a
 * bare IRI, because URL state must be portable across deployments with
 * different prefix maps.
 */
export function describeIriExpand(
  input: string,
  prefixes: Record<string, string>,
): DescribeIriExpandResult {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: 'Enter a seed IRI.' };
  }

  if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
    const inner = trimmed.slice(1, -1);
    if (inner.length === 0) {
      return { ok: false, error: 'Empty IRI between the angle brackets.' };
    }
    return { ok: true, iri: inner };
  }

  if (ABSOLUTE_IRI.test(trimmed)) {
    return { ok: true, iri: trimmed };
  }

  const pname = PREFIXED_NAME.exec(trimmed);
  if (pname) {
    const prefix = pname[1] ?? '';
    const local = pname[2];
    const namespace = prefixes[prefix];
    if (namespace === undefined) {
      const shown = prefix.length === 0 ? '(default)' : prefix;
      return {
        ok: false,
        error:
          `Unknown prefix "${shown}". It is not in the configured prefix map — ` +
          'wrap a full IRI in angle brackets, e.g. <http://example.org/alice>.',
      };
    }
    return { ok: true, iri: namespace + local };
  }

  return {
    ok: false,
    error:
      'Not an absolute IRI or a known prefixed name. Use <http://…>, ' +
      'http://…, or prefix:local.',
  };
}
