import { err, ok, type Result } from 'neverthrow';
import type {
  ParsedGlobSource,
  ParsedSource,
  ParsedViewSource,
} from '../sources';

/**
 * Source kind a view's `from:` chain bottoms on when it does *not* reach a
 * glob. Used by the leaf-glob walker so callers can render kind-specific
 * messages (HTTP `404 { kind }`, pin-propagation rejection text, ...) without
 * re-classifying the upstream themselves.
 */
export type ViewChainNonGlobKind = 'endpoint' | 'empty' | 'reference' | 'file';

export type ViewChainResolutionFailure =
  | {
      kind: 'view-chain-unknown-upstream';
      /** Entry view at which the walk started. */
      entryViewId: string;
      /** `from:` id (without `@`) that wasn't in the registry. */
      fromId: string;
    }
  | {
      kind: 'view-chain-non-glob';
      /** Entry view at which the walk started. */
      entryViewId: string;
      /** Source kind the chain terminated on. */
      terminatingKind: ViewChainNonGlobKind;
      /**
       * Id of the upstream that terminated the walk. May be `undefined` when
       * the terminating source has no declared id (synthesized references).
       */
      terminatingId: string | undefined;
    };

/**
 * Walks a view's `from:` chain — recursing through intermediate views — until
 * it reaches a glob, and returns that leaf glob. Pure over the parsed
 * registry — no I/O.
 *
 * Used by both ADR-0029's pin propagation (which attaches an invocation-time
 * `ref` to the returned leaf) and the webapp ref-discovery endpoint (which
 * lists refs from the leaf's repo). The walker itself is unconcerned with
 * either use case — it only locates the glob.
 */
export function resolveViewLeafGlob(
  view: ParsedViewSource,
  registry: ReadonlyArray<ParsedSource>,
): Result<ParsedGlobSource & { id: string }, ViewChainResolutionFailure> {
  const byId = new Map<string, ParsedSource>();
  for (const src of registry) {
    if (src.kind === 'reference') continue;
    if (src.id === undefined) continue;
    byId.set(src.id, src);
  }
  return walk(view, byId, view.id);
}

function walk(
  view: ParsedViewSource,
  byId: ReadonlyMap<string, ParsedSource>,
  entryViewId: string,
): Result<ParsedGlobSource & { id: string }, ViewChainResolutionFailure> {
  const upstream = byId.get(view.from);
  if (upstream === undefined) {
    return err({
      kind: 'view-chain-unknown-upstream',
      entryViewId,
      fromId: view.from,
    });
  }
  if (upstream.kind === 'glob') {
    return ok(upstream as ParsedGlobSource & { id: string });
  }
  if (upstream.kind === 'view') {
    return walk(upstream, byId, entryViewId);
  }
  return err({
    kind: 'view-chain-non-glob',
    entryViewId,
    terminatingKind: upstream.kind,
    terminatingId: upstream.id ?? view.from,
  });
}
