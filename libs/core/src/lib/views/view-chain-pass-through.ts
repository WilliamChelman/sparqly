import { storageTier } from '../sources/glob-storage';
import type { ParsedSource, ParsedViewSource } from '../sources/source-spec';

export type PassThroughChainSource =
  | { kind: 'endpoint'; url: string }
  | { kind: 'disk-backed-glob'; label: string };

// Raw endpoint / disk-backed-glob targets are rejected at the raw-target check
// before resolution (ADR-0047), so this returns undefined for them — only view
// targets can reach the warning path.
export function viewChainPassThroughSource(
  target: ParsedSource,
  registry: ReadonlyArray<ParsedSource>,
): PassThroughChainSource | undefined {
  if (target.kind !== 'view') return undefined;
  const byId = new Map<string, ParsedSource>();
  for (const src of registry) {
    if (src.kind === 'reference') continue;
    if (src.id === undefined) continue;
    byId.set(src.id, src);
  }
  return walk(target, byId, new Set([target.id]));
}

function walk(
  view: ParsedViewSource,
  byId: ReadonlyMap<string, ParsedSource>,
  seen: Set<string>,
): PassThroughChainSource | undefined {
  const upstream = byId.get(view.from);
  if (upstream === undefined) return undefined;
  if (upstream.kind === 'endpoint') {
    return { kind: 'endpoint', url: upstream.endpoint };
  }
  if (upstream.kind === 'glob' && storageTier(upstream) === 'disk') {
    const label = upstream.id !== undefined ? `@${upstream.id}` : upstream.glob;
    return { kind: 'disk-backed-glob', label };
  }
  if (upstream.kind === 'view') {
    if (seen.has(upstream.id)) return undefined;
    seen.add(upstream.id);
    return walk(upstream, byId, seen);
  }
  return undefined;
}
