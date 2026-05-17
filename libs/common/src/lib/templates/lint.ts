import { err, ok, type Result } from 'neverthrow';
import type { ParameterDeclaration } from './parameter-declaration';

export type LintError =
  | { kind: 'declared-but-unused'; name: string }
  | { kind: 'undeclared-body-variable'; name: string };

const VAR_PATTERN = /[?$]([A-Za-z_][\w]*)/g;
const SELECT_HEADER = /\bSELECT\b\s*(?:DISTINCT|REDUCED)?\s+([^{]*?)(?:\bWHERE\b|\{)/i;

export function lint(
  declarations: ReadonlyArray<ParameterDeclaration>,
  body: string,
): Result<void, LintError> {
  const declaredNames = new Set(declarations.map((d) => d.name));
  const allBodyVars = extractVars(body);
  const projection = extractProjection(body);

  for (const decl of declarations) {
    if (!allBodyVars.has(decl.name)) {
      return err({ kind: 'declared-but-unused', name: decl.name });
    }
  }

  // The undeclared-body-variable check is only meaningful for templated
  // queries — when no parameters are declared, every body var is a normal
  // SPARQL pattern variable, not a typo for a missing declaration.
  if (declaredNames.size > 0) {
    for (const name of allBodyVars) {
      if (projection.has(name)) continue;
      if (declaredNames.has(name)) continue;
      return err({ kind: 'undeclared-body-variable', name });
    }
  }
  return ok(undefined);
}

function extractVars(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(VAR_PATTERN)) {
    out.add(m[1]);
  }
  return out;
}

function extractProjection(body: string): Set<string> {
  const m = SELECT_HEADER.exec(body);
  if (!m) return new Set();
  const head = m[1];
  if (head.trim().startsWith('*')) {
    return extractVars(body);
  }
  return extractVars(head);
}

