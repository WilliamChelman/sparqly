import type { SourceSpecInput, SourceSpecObjectInput } from './source-spec';

export interface ResolveSourceReferencesContext {
  /**
   * Registry of named source-spec definitions. Pass `null` when no config file
   * is loaded; encountering an `@id` reference in that case is a hard error.
   */
  registry: ReadonlyArray<SourceSpecInput> | null;
}

const REFERENCE_PREFIX = /^@(.+)$/;

export function resolveSourceReferences(
  inputs: ReadonlyArray<SourceSpecInput>,
  ctx: ResolveSourceReferencesContext,
): SourceSpecInput[] {
  return inputs.map((entry) => {
    if (typeof entry === 'string') {
      const refMatch = REFERENCE_PREFIX.exec(entry);
      if (refMatch) return inlineRef(refMatch[1], ctx);
    }
    return entry;
  });
}

function inlineRef(
  id: string,
  ctx: ResolveSourceReferencesContext,
): SourceSpecObjectInput {
  if (ctx.registry === null) {
    throw new Error(
      `cannot resolve @id reference "@${id}": no config file is loaded`,
    );
  }
  const map = buildRegistryMap(ctx.registry);
  const found = map.get(id);
  if (!found) {
    const known = [...map.keys()];
    const list = known.length === 0 ? '<none>' : known.map((k) => `@${k}`).join(', ');
    throw new Error(
      `unknown @id reference "@${id}"; defined ids: ${list}`,
    );
  }
  const { id: _id, ...rest } = found;
  return rest;
}

function buildRegistryMap(
  registry: ReadonlyArray<SourceSpecInput>,
): Map<string, SourceSpecObjectInput> {
  const map = new Map<string, SourceSpecObjectInput>();
  for (const entry of registry) {
    if (typeof entry === 'string') continue;
    if (entry.id === undefined) continue;
    map.set(entry.id, entry);
  }
  return map;
}
