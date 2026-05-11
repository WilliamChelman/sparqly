import { Parser as SparqlParser } from 'sparqljs';

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
}

export function validateViewQuery(
  query: string,
  options: ValidateViewQueryOptions = {},
): void {
  const mode = options.mode ?? 'strict';
  const parsed = new SparqlParser().parse(query);
  if (parsed.type === 'update') {
    throw new Error(
      'UPDATE queries are not allowed for a view query; use SELECT or CONSTRUCT.',
    );
  }
  if (parsed.type === 'query') {
    if (parsed.queryType === 'ASK') {
      throw new Error(
        'ASK queries are not allowed for a view query; use SELECT or CONSTRUCT.',
      );
    }
    if (parsed.queryType === 'DESCRIBE') {
      throw new Error(
        'DESCRIBE queries are not allowed for a view query; use SELECT or CONSTRUCT.',
      );
    }
    if (parsed.queryType === 'SELECT') {
      assertSelectProjection(parsed.variables, mode);
    }
  }
}

function assertSelectProjection(
  variables: ReadonlyArray<unknown>,
  mode: ViewQueryMode,
): void {
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
    // Aliased projections like `(str(?x) AS ?y)` parse as
    // `{ expression, variable: <Variable> }`. Tabular-anon accepts them
    // (the alias names the column); strict mode rejects them — they can't
    // satisfy the {?s,?p,?o[,?g]} projection contract.
    const alias = term?.variable;
    if (
      mode === 'tabular-anon' &&
      alias?.termType === 'Variable' &&
      typeof alias.value === 'string'
    ) {
      names.push(alias.value);
      continue;
    }
    throw new Error(
      mode === 'tabular-anon'
        ? 'SELECT must project named variables or aliased expressions (no `SELECT *`).'
        : 'SELECT view query must project exactly {?s, ?p, ?o} or {?s, ?p, ?o, ?g} (no SELECT *, no expressions).',
    );
  }
  if (mode === 'tabular-anon') return;
  const sorted = [...names].sort().join(',');
  if (sorted !== 'o,p,s' && sorted !== 'g,o,p,s') {
    throw new Error(
      'SELECT view query must project exactly {?s, ?p, ?o} or {?s, ?p, ?o, ?g}.',
    );
  }
}
