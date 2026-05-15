import { err, ok, type Result } from 'neverthrow';
import type {
  ParsedGlobSource,
  ParsedSource,
  ParsedViewSource,
} from '../sources';
import type { GitPinError } from '../sources/errors';

/**
 * Successful propagation: the `from:` chain from the entry view bottoms on a
 * glob source, and the invocation-time ref has been carried down to that leaf.
 * The caller uses `leafGlob.id` to identify the source to pin and `ref` as the
 * ref to attach (overriding any declared `gitRef` per ADR-0029).
 */
export interface PropagatedViewPin {
  /** Leaf glob discovered at the bottom of the `from:` chain. */
  leafGlob: ParsedGlobSource & { id: string };
  /** Ref string to attach to that leaf, overriding any declared `gitRef`. */
  ref: string;
}

/**
 * Walks a view's `from:` chain — recursing through intermediate views — until
 * it reaches a glob, and returns the leaf glob carrying the invocation-time
 * `ref` (ADR-0029, slice #6). Pure over the parsed registry — no I/O.
 *
 * Errors when the chain bottoms on a `kind:'endpoint'` or `kind:'empty'`
 * source: the message names the offending source id. SERVICE clauses inside
 * any view's query are not part of the `from:` chain and are out-of-scope.
 */
export function propagateViewPin(
  view: ParsedViewSource,
  ref: string,
  registry: ReadonlyArray<ParsedSource>,
): Result<PropagatedViewPin, GitPinError> {
  return walk(view, ref, registry, view.id);
}

function walk(
  view: ParsedViewSource,
  ref: string,
  registry: ReadonlyArray<ParsedSource>,
  entryViewId: string,
): Result<PropagatedViewPin, GitPinError> {
  const byId = new Map<string, ParsedSource>();
  for (const src of registry) {
    if (src.kind === 'reference') continue;
    if (src.id === undefined) continue;
    byId.set(src.id, src);
  }
  const upstream = byId.get(view.from);
  if (upstream === undefined) {
    return err({
      kind: 'git-pin',
      reason: 'unresolvable-ref',
      message: `cannot pin \`@${entryViewId}\`: unknown \`from:\` ref \`@${view.from}\``,
    });
  }
  if (upstream.kind === 'glob') {
    return ok({
      leafGlob: upstream as ParsedGlobSource & { id: string },
      ref,
    });
  }
  if (upstream.kind === 'view') {
    return walk(upstream, ref, registry, entryViewId);
  }
  return err({
    kind: 'git-pin',
    reason: 'unresolvable-ref',
    message: `cannot pin \`@${entryViewId}\`: upstream chain reaches \`kind:'${upstream.kind}'\` source \`@${upstream.id ?? view.from}\``,
  });
}
