import { err, ok, type Result } from 'neverthrow';
import type {
  ParameterCardinality,
  ParameterDeclaration,
} from './parameter-declaration';

export interface SubstitutionInput {
  body: string;
  parameters: ReadonlyArray<ParameterDeclaration>;
}

export type ParameterBindings = Readonly<Record<string, unknown>>;

export type SubstitutionError =
  | { kind: 'unsupported-type'; name: string }
  | { kind: 'invalid-binding'; name: string; reason: string };

export function substitute(
  input: SubstitutionInput,
  bindings: ParameterBindings,
): Result<string, SubstitutionError> {
  const presentColumns: Array<{
    decl: ParameterDeclaration;
    values: unknown[];
  }> = [];
  for (const decl of input.parameters) {
    const raw = bindings[decl.name];
    const valuesForColumn = collectValues(raw);
    if (isOmitted(decl.cardinality, valuesForColumn)) continue;
    presentColumns.push({ decl, values: valuesForColumn });
  }
  if (presentColumns.length === 0) return ok(input.body);

  const rowCount = Math.max(...presentColumns.map((c) => c.values.length), 1);
  const header = presentColumns.map((c) => `?${c.decl.name}`).join(' ');
  const rows: string[] = [];
  for (let i = 0; i < rowCount; i += 1) {
    const cells: string[] = [];
    for (const col of presentColumns) {
      const v = col.values[i] ?? col.values[col.values.length - 1];
      const escaped = escape(col.decl, v);
      if (escaped.isErr()) return err(escaped.error);
      cells.push(escaped.value);
    }
    rows.push(`(${cells.join(' ')})`);
  }
  const clause = `VALUES (${header}) { ${rows.join(' ')} }\n`;
  return ok(clause + input.body);
}

function collectValues(raw: unknown): unknown[] {
  if (raw === undefined || raw === null) return [];
  if (Array.isArray(raw)) return raw;
  return [raw];
}

function isOmitted(
  cardinality: ParameterCardinality,
  values: unknown[],
): boolean {
  if (values.length > 0) return false;
  return cardinality === '0..1' || cardinality === '0..n';
}

function escape(
  decl: ParameterDeclaration,
  value: unknown,
): Result<string, SubstitutionError> {
  switch (decl.type) {
    case 'iri':
      return ok(`<${value as string}>`);
    case 'string':
      return ok(`"${escapeStringLiteral(value as string)}"`);
    case 'integer':
    case 'decimal':
      return ok(String(value as number));
    case 'boolean':
      return ok((value as boolean) ? 'true' : 'false');
    case 'date':
      return ok(`"${escapeStringLiteral(value as string)}"^^xsd:date`);
    case 'dateTime':
      return ok(`"${escapeStringLiteral(value as string)}"^^xsd:dateTime`);
    case 'langString': {
      const v = value as { value: string; lang: string };
      return ok(`"${escapeStringLiteral(v.value)}"@${v.lang}`);
    }
    case 'literal': {
      const datatype = decl.datatype;
      if (typeof datatype !== 'string') {
        return err({
          kind: 'invalid-binding',
          name: decl.name,
          reason: 'literal parameter requires datatype',
        });
      }
      return ok(
        `"${escapeStringLiteral(value as string)}"^^<${datatype}>`,
      );
    }
  }
}

function escapeStringLiteral(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}
