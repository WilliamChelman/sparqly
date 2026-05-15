import { Store } from 'n3';
import { ResultAsync } from 'neverthrow';
import type { SparqlyLogger } from 'common';
import { loadRdfResult } from '../engine';
import {
  applyTransformPipeline,
  type ParsedGlobSource,
  type ParsedViewSource,
} from '../sources';
import type { GitPort } from '../sources/git/git-port';
import { pinGlobSource } from '../sources/git/pin-glob-source';
import type { RepoDiscoveryDeps } from '../sources/git/discover-repo';
import type { GitPinError, GlobLoadError } from '../sources/errors';

export type LoadPinnedGlobError = GlobLoadError | GitPinError;

export interface PinDeps {
  configDir: string;
  gitPort: GitPort;
  repoDiscovery: RepoDiscoveryDeps;
}

export function loadPinnedGlobUpstreamResult(
  view: ParsedViewSource,
  globUpstream: ParsedGlobSource,
  logger: SparqlyLogger | undefined,
  pinDeps: PinDeps,
): ResultAsync<Store, LoadPinnedGlobError> {
  const effectivePin = effectivePinFor(view, globUpstream);
  if (effectivePin === undefined) {
    return loadRdfResult({ sources: globUpstream.glob, logger }).map((sub) =>
      applyTransformPipeline(sub.store, globUpstream.transforms ?? [], {
        perFileRecords: sub.perFileRecords,
      }),
    );
  }
  const pinnedGlob: ParsedGlobSource = {
    ...globUpstream,
    gitRef: effectivePin,
    resolvedSha: undefined,
  };
  return pinGlobSource(
    { source: pinnedGlob, configDir: pinDeps.configDir },
    {
      port: pinDeps.gitPort,
      repoDiscovery: pinDeps.repoDiscovery,
      logger,
    },
  )
    .mapErr<LoadPinnedGlobError>((e) => e)
    .andThen<Store, LoadPinnedGlobError>((pinned) =>
      loadRdfResult({
        sources: globUpstream.glob,
        logger,
        contentReader: pinned.contentReader,
      }).map((sub) =>
        applyTransformPipeline(sub.store, globUpstream.transforms ?? [], {
          perFileRecords: sub.perFileRecords,
        }),
      ),
    );
}

function effectivePinFor(
  view: ParsedViewSource,
  upstream: ParsedGlobSource,
): string | undefined {
  if (view.fromGitRef !== undefined) return view.fromGitRef;
  return upstream.gitRef;
}

/**
 * Hard error reported when a view's `from: @<id>:<ref>` targets an upstream
 * whose kind cannot carry a git pin in this slice. Chain-walk propagation
 * across views, and the endpoint/empty bottoming cases, are slice #6 of
 * ADR-0029.
 */
export function nonGlobPinError(
  view: ParsedViewSource,
  upstreamKind: 'view' | 'endpoint' | 'empty' | 'file',
  upstreamId: string,
): GitPinError {
  const ref = view.fromGitRef ?? '';
  if (upstreamKind === 'view') {
    return {
      kind: 'git-pin',
      reason: 'unresolvable-ref',
      message: `view "${view.id}": pinning \`from: @${upstreamId}:${ref}\` is not yet supported — view-of-view pin propagation lands in ADR-0029 slice #6`,
    };
  }
  if (upstreamKind === 'endpoint') {
    return {
      kind: 'git-pin',
      reason: 'unresolvable-ref',
      message: `view "${view.id}": cannot pin \`from: @${upstreamId}:${ref}\` — endpoint upstreams have no git revision (ADR-0029)`,
    };
  }
  if (upstreamKind === 'empty') {
    return {
      kind: 'git-pin',
      reason: 'unresolvable-ref',
      message: `view "${view.id}": cannot pin \`from: @${upstreamId}:${ref}\` — empty upstreams have no git revision (ADR-0029)`,
    };
  }
  return {
    kind: 'git-pin',
    reason: 'unresolvable-ref',
    message: `view "${view.id}": pinning \`from: @${upstreamId}:${ref}\` against a file (split-glob child) upstream is not yet supported (ADR-0029 slice #6)`,
  };
}
