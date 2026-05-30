import { Result, err, ok } from 'neverthrow';
import { Parser as SparqlParser } from 'sparqljs';
import type { ViewValidationError } from '../sources/errors';

export type InlineQueryMode = 'strict' | 'tabular-anon';

export interface ValidateInlineQueryOptions {
  /**
   * `'strict'` (default) — the historical contract: SELECT must project
   * exactly `{?s,?p,?o[,?g]}`; CONSTRUCT is accepted as-is.
   *
   * `'tabular-anon'` — used by `diff`'s inline queries to enable **tabular
   * diff**. SELECT projections are accepted unrestricted; UPDATE/ASK/DESCRIBE
   * are still rejected, and `SELECT *` is still rejected (no stable
   * projected-variable list).
   */
  mode?: InlineQueryMode;
}

/**
 * `Result`-typed validator for an inline query. Returns `Result.ok(undefined)`
 * on success and a {@link ViewValidationError} carrying the underlying message
 * on failure (ADR-0024).
 */
export function validateInlineQueryResult(
  query: string,
  options: ValidateInlineQueryOptions = {},
): Result<void, ViewValidationError> {
  const mode = options.mode ?? 'strict';
  try {
    const parsed = new SparqlParser().parse(query);
    if (parsed.type === 'update') {
      return err(
        toError('UPDATE queries are not allowed for an inline query; use SELECT or CONSTRUCT.'),
      );
    }
    if (parsed.type === 'query') {
      if (parsed.queryType === 'ASK') {
        return err(
          toError('ASK queries are not allowed for an inline query; use SELECT or CONSTRUCT.'),
        );
      }
      if (parsed.queryType === 'DESCRIBE') {
        return err(
          toError('DESCRIBE queries are not allowed for an inline query; use SELECT or CONSTRUCT.'),
        );
      }
      if (parsed.queryType === 'SELECT') {
        const projection = checkSelectProjection(parsed.variables, mode);
        if (projection !== undefined) return err(toError(projection));
      }
    }
    return ok(undefined);
  } catch (e) {
    return err(toError(e instanceof Error ? e.message : String(e)));
  }
}

function toError(message: string): ViewValidationError {
  return { kind: 'view-validation', message };
}

function checkSelectProjection(
  variables: ReadonlyArray<unknown>,
  mode: InlineQueryMode,
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
      : 'SELECT inline query must project exactly {?s, ?p, ?o} or {?s, ?p, ?o, ?g} (no SELECT *, no expressions).';
  }
  if (mode === 'tabular-anon') return undefined;
  const sorted = [...names].sort().join(',');
  if (sorted !== 'o,p,s' && sorted !== 'g,o,p,s') {
    return 'SELECT inline query must project exactly {?s, ?p, ?o} or {?s, ?p, ?o, ?g}.';
  }
  return undefined;
}
