import { Result, err, ok } from 'neverthrow';
import { Parser as SparqlParser } from 'sparqljs';
import type { ViewValidationError } from '../sources/errors';

export type ViewQueryMode = 'strict' | 'tabular-anon';

export interface ValidateViewQueryOptions {
  /**
   * `'strict'` (default) — the historical contract: SELECT must project
   * exactly `{?s,?p,?o[,?g]}`; CONSTRUCT is accepted as-is.
   *
   * `'tabular-anon'` — used by `diff`'s anonymous views to enable **tabular
   * diff**. SELECT projections are accepted unrestricted; UPDATE/ASK/DESCRIBE
   * are still rejected, and `SELECT *` is still rejected (no stable
   * projected-variable list).
   */
  mode?: ViewQueryMode;
  /**
   * Forwarded into the {@link ViewValidationError} when supplied so callers
   * can attribute the failure to a specific view. Anonymous-view validation
   * sites omit it.
   */
  viewId?: string;
}

/**
 * Primary `Result`-typed validator. Returns `Result.ok(undefined)` on success
 * and a {@link ViewValidationError} carrying the supplied `viewId` (when any)
 * and the underlying message on failure (ADR-0024).
 */
export function validateViewQueryResult(
  query: string,
  options: ValidateViewQueryOptions = {},
): Result<void, ViewValidationError> {
  const mode = options.mode ?? 'strict';
  try {
    const parsed = new SparqlParser().parse(query);
    if (parsed.type === 'update') {
      return err(
        toError(options.viewId, 'UPDATE queries are not allowed for a view query; use SELECT or CONSTRUCT.'),
      );
    }
    if (parsed.type === 'query') {
      if (parsed.queryType === 'ASK') {
        return err(
          toError(options.viewId, 'ASK queries are not allowed for a view query; use SELECT or CONSTRUCT.'),
        );
      }
      if (parsed.queryType === 'DESCRIBE') {
        return err(
          toError(options.viewId, 'DESCRIBE queries are not allowed for a view query; use SELECT or CONSTRUCT.'),
        );
      }
      if (parsed.queryType === 'SELECT') {
        const projection = checkSelectProjection(parsed.variables, mode);
        if (projection !== undefined) return err(toError(options.viewId, projection));
      }
    }
    return ok(undefined);
  } catch (e) {
    return err(toError(options.viewId, e instanceof Error ? e.message : String(e)));
  }
}

/**
 * @deprecated Use {@link validateViewQueryResult} (ADR-0024). Retained as a
 * thin throw-based adapter for callers that have not migrated yet.
 */
export function validateViewQuery(
  query: string,
  options: ValidateViewQueryOptions = {},
): void {
  const result = validateViewQueryResult(query, options);
  if (result.isErr()) {
    throw new Error(result.error.message);
  }
}

function toError(viewId: string | undefined, message: string): ViewValidationError {
  return viewId !== undefined
    ? { kind: 'view-validation', viewId, message }
    : { kind: 'view-validation', message };
}

function checkSelectProjection(
  variables: ReadonlyArray<unknown>,
  mode: ViewQueryMode,
): string | undefined {
  const names: string[] = [];
  for (const v of variables) {
    const term = v as {
      termType?: string;
      value?: string;
      variable?: { termType?: string; value?: string };
    };
    if (term?.termType === 'Variable' && typeof term.value === 'string') {
      names.push(term.value);
      continue;
    }
    const alias = term?.variable;
    if (
      mode === 'tabular-anon' &&
      alias?.termType === 'Variable' &&
      typeof alias.value === 'string'
    ) {
      names.push(alias.value);
      continue;
    }
    return mode === 'tabular-anon'
      ? 'SELECT must project named variables or aliased expressions (no `SELECT *`).'
      : 'SELECT view query must project exactly {?s, ?p, ?o} or {?s, ?p, ?o, ?g} (no SELECT *, no expressions).';
  }
  if (mode === 'tabular-anon') return undefined;
  const sorted = [...names].sort().join(',');
  if (sorted !== 'o,p,s' && sorted !== 'g,o,p,s') {
    return 'SELECT view query must project exactly {?s, ?p, ?o} or {?s, ?p, ?o, ?g}.';
  }
  return undefined;
}
