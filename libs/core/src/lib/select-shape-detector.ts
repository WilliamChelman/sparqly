import { Parser as SparqlParser } from 'sparqljs';

export type SelectShape = 'triples' | 'tuples';

export interface SelectShapeReport {
  shape: SelectShape;
  /**
   * Projected variable names in projection order, omitting any leading `?`.
   * Empty for CONSTRUCT (no projection).
   */
  variables: string[];
  /**
   * `true` when the SELECT carries `LIMIT`/`OFFSET` without an `ORDER BY` —
   * a silent non-determinism trap callers should surface to the user.
   */
  warnLimitOffsetWithoutOrderBy: boolean;
}

/**
 * Classify a SPARQL query as **triples-shape** (CONSTRUCT, or SELECT projecting
 * exactly `{?s,?p,?o[,?g]}`) vs **tuples-shape** (any other SELECT projection).
 * Rejects UPDATE/ASK/DESCRIBE — `diff` requires a query that produces rows or
 * triples on both sides.
 */
export function detectSelectShape(query: string): SelectShapeReport {
  const parsed = new SparqlParser().parse(query) as {
    type: string;
    queryType?: string;
    variables?: ReadonlyArray<unknown>;
    order?: unknown;
    limit?: unknown;
    offset?: unknown;
  };
  if (parsed.type === 'update') {
    throw new Error(
      'UPDATE queries are not allowed for a diff query; use SELECT or CONSTRUCT.',
    );
  }
  if (parsed.queryType === 'ASK') {
    throw new Error(
      'ASK queries are not allowed for a diff query; use SELECT or CONSTRUCT.',
    );
  }
  if (parsed.queryType === 'DESCRIBE') {
    throw new Error(
      'DESCRIBE queries are not allowed for a diff query; use SELECT or CONSTRUCT.',
    );
  }
  if (parsed.queryType === 'CONSTRUCT') {
    return {
      shape: 'triples',
      variables: [],
      warnLimitOffsetWithoutOrderBy: false,
    };
  }
  // SELECT
  const variables = projectedVariables(parsed.variables ?? []);
  const triplesProjection = isTriplesProjection(variables);
  const hasOrderBy = Array.isArray(parsed.order) && parsed.order.length > 0;
  const hasLimitOrOffset =
    typeof parsed.limit === 'number' || typeof parsed.offset === 'number';
  return {
    shape: triplesProjection ? 'triples' : 'tuples',
    variables,
    warnLimitOffsetWithoutOrderBy: hasLimitOrOffset && !hasOrderBy,
  };
}

function projectedVariables(variables: ReadonlyArray<unknown>): string[] {
  const out: string[] = [];
  for (const v of variables) {
    const term = v as { termType?: string; value?: string };
    if (term?.termType !== 'Variable' || typeof term.value !== 'string') {
      // SELECT * or projection expressions cannot be triples-shape, and we
      // need *some* name for tabular mode; throw rather than guess.
      throw new Error(
        'SELECT must project named variables (no `SELECT *`, no projection expressions).',
      );
    }
    out.push(term.value);
  }
  return out;
}

function isTriplesProjection(names: ReadonlyArray<string>): boolean {
  const sorted = [...names].sort().join(',');
  return sorted === 'o,p,s' || sorted === 'g,o,p,s';
}
