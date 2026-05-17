import { err, ok, type Result } from 'neverthrow';
import type { ParameterDeclaration } from './parameter-declaration';
import type { ParameterBindings } from './substitute';

export type BindingError =
  | { kind: 'type-mismatch'; name: string; expected: string; received: string }
  | { kind: 'cardinality-violation'; name: string; cardinality: string };

export function validate(
  declarations: ReadonlyArray<ParameterDeclaration>,
  bindings: ParameterBindings,
): Result<ParameterBindings, BindingError> {
  for (const decl of declarations) {
    const raw = bindings[decl.name];
    const values = collectValues(raw);

    if (values.length === 0) {
      if (decl.cardinality === '1..1' || decl.cardinality === '1..n') {
        return err({
          kind: 'cardinality-violation',
          name: decl.name,
          cardinality: decl.cardinality,
        });
      }
      continue;
    }

    for (const v of values) {
      const typeCheck = checkType(decl, v);
      if (typeCheck.isErr()) return err(typeCheck.error);
    }
  }
  return ok(bindings);
}

function collectValues(raw: unknown): unknown[] {
  if (raw === undefined || raw === null) return [];
  if (Array.isArray(raw)) return raw;
  return [raw];
}

function checkType(
  decl: ParameterDeclaration,
  value: unknown,
): Result<void, BindingError> {
  const received = jsTypeOf(value);
  const mismatch = (expected: string) =>
    err<void, BindingError>({
      kind: 'type-mismatch',
      name: decl.name,
      expected,
      received,
    });
  switch (decl.type) {
    case 'iri':
    case 'string':
    case 'date':
    case 'dateTime':
    case 'literal':
      return typeof value === 'string' ? ok(undefined) : mismatch(decl.type);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value)
        ? ok(undefined)
        : mismatch('integer');
    case 'decimal':
      return typeof value === 'number' ? ok(undefined) : mismatch('decimal');
    case 'boolean':
      return typeof value === 'boolean' ? ok(undefined) : mismatch('boolean');
    case 'langString': {
      const ok1 =
        typeof value === 'object' &&
        value !== null &&
        typeof (value as { value?: unknown }).value === 'string' &&
        typeof (value as { lang?: unknown }).lang === 'string';
      return ok1 ? ok(undefined) : mismatch('langString');
    }
  }
}

function jsTypeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}
