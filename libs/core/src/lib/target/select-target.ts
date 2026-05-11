import { parseSourceSpec, type ParsedSource } from '../sources';

export function selectTarget(
  registry: ReadonlyArray<ParsedSource>,
  target?: string,
): ParsedSource {
  const picked = pick(registry, target);
  if (picked.kind === 'reference') {
    throw new Error(
      "selectTarget: `kind: 'reference'` entries are aliases, not data, and cannot be used as a target source",
    );
  }
  return picked;
}

function pick(
  registry: ReadonlyArray<ParsedSource>,
  target: string | undefined,
): ParsedSource {
  if (target !== undefined) {
    if (target.startsWith('@')) return resolveRef(registry, target);
    return parseSourceSpec(target);
  }
  const defaulted = registry.find(
    (s) => (s as { default?: true }).default === true,
  );
  if (defaulted !== undefined) return defaulted;
  if (registry.length === 1) return registry[0];
  if (registry.length === 0) {
    throw new Error(
      'selectTarget: registry is empty; no target source to select',
    );
  }
  throw new Error(
    `selectTarget: registry has multiple entries and no \`default: true\`; pass an explicit target. Available: ${availableIds(registry)}`,
  );
}

function resolveRef(
  registry: ReadonlyArray<ParsedSource>,
  target: string,
): ParsedSource {
  const ref = target.slice(1);
  const entry = registry.find((s) => s.id === ref);
  if (entry !== undefined) return entry;
  throw new Error(
    `selectTarget: no source matches ${target}. Available: ${availableIds(registry)}`,
  );
}

function availableIds(registry: ReadonlyArray<ParsedSource>): string {
  const ids = registry
    .map((s) => s.id)
    .filter((id): id is string => id !== undefined)
    .map((id) => `@${id}`);
  return ids.length === 0 ? '<none>' : ids.join(', ');
}
