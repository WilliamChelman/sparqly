import {
  Document,
  isMap,
  isScalar,
  parseDocument,
  Scalar,
  YAMLMap,
  YAMLSeq,
} from 'yaml';
import { lint, type LintError, ParameterDeclarationSchema } from 'common';
import type { ParameterDeclaration } from 'common';
import type { Result } from 'neverthrow';
import type { SavedQueryEntry } from './saved-query-entry';

/**
 * Sidecar shape:
 *
 *   savedQueries:
 *     <slug>:
 *       description?: string
 *       body: string  (always YAML literal block in writes)
 *       parameters?: [...]   (preserved if present; deferred to a later slice)
 *
 * Unknown sibling fields and user comments are preserved across writes by
 * mutating the `yaml` Document AST in place instead of serializing a fresh
 * object graph (ADR-0036).
 */
export type SidecarDocument = Document.Parsed;

const ROOT_KEY = 'savedQueries';

export function parseSidecar(text: string): SidecarDocument {
  return parseDocument(text);
}

export function serializeSidecar(doc: SidecarDocument): string {
  return doc.toString();
}

export interface SavedQueryEntrySummary {
  slug: string;
  description?: string;
  hasParameters: boolean;
}

export function listEntries(doc: SidecarDocument): SavedQueryEntrySummary[] {
  const root = getRootMap(doc);
  if (!root) return [];
  const out: SavedQueryEntrySummary[] = [];
  for (const item of root.items) {
    const slug = scalarKey(item.key);
    if (slug === undefined) continue;
    const value = item.value;
    if (!isMap(value)) continue;
    out.push({
      slug,
      description: optionalString(value, 'description'),
      hasParameters: hasNonEmptyList(value, 'parameters'),
    });
  }
  return out;
}

export function getEntry(
  doc: SidecarDocument,
  slug: string,
): SavedQueryEntry | undefined {
  const root = getRootMap(doc);
  if (!root) return undefined;
  const node = root.get(slug, true);
  if (!isMap(node)) return undefined;
  const body = optionalString(node, 'body');
  if (body === undefined) return undefined;
  const entry: SavedQueryEntry = { slug, body };
  const description = optionalString(node, 'description');
  if (description !== undefined) entry.description = description;
  const parameters = optionalParameters(node);
  if (parameters !== undefined) entry.parameters = parameters;
  return entry;
}

function optionalParameters(
  map: YAMLMap,
): ParameterDeclaration[] | undefined {
  const node = map.get('parameters', true);
  if (!(node instanceof YAMLSeq)) return undefined;
  const plain = node.toJSON();
  if (!Array.isArray(plain)) return undefined;
  return plain.map((p) => ParameterDeclarationSchema.parse(p));
}

export function upsertEntry(
  doc: SidecarDocument,
  entry: SavedQueryEntry,
): { created: boolean } {
  const root = ensureRootMap(doc);
  const existing = root.get(entry.slug, true);
  if (isMap(existing)) {
    setStringField(existing, 'description', entry.description);
    setBodyField(existing, entry.body);
    setParametersField(existing, entry.parameters);
    return { created: false };
  }
  const newMap = new YAMLMap();
  newMap.flow = false;
  if (entry.description !== undefined) {
    newMap.set('description', entry.description);
  }
  newMap.set('body', makeBodyScalar(entry.body));
  if (entry.parameters !== undefined && entry.parameters.length > 0) {
    newMap.set('parameters', makeParametersSeq(entry.parameters));
  }
  root.flow = false;
  root.set(entry.slug, newMap);
  return { created: true };
}

export function lintEntry(
  entry: SavedQueryEntry,
): Result<void, LintError> {
  return lint(entry.parameters ?? [], entry.body);
}

export function removeEntry(doc: SidecarDocument, slug: string): boolean {
  const root = getRootMap(doc);
  if (!root) return false;
  if (!root.has(slug)) return false;
  root.delete(slug);
  return true;
}

function getRootMap(doc: SidecarDocument): YAMLMap | undefined {
  const contents = doc.contents;
  if (!isMap(contents)) return undefined;
  const node = contents.get(ROOT_KEY, true);
  return isMap(node) ? node : undefined;
}

function ensureRootMap(doc: SidecarDocument): YAMLMap {
  const contents = doc.contents;
  let topMap: YAMLMap;
  if (isMap(contents)) {
    topMap = contents;
  } else {
    topMap = new YAMLMap();
    doc.contents = topMap as unknown as typeof doc.contents;
  }
  const existing = topMap.get(ROOT_KEY, true);
  if (isMap(existing)) {
    return existing;
  }
  const fresh = new YAMLMap();
  topMap.set(ROOT_KEY, fresh);
  return fresh;
}

function scalarKey(key: unknown): string | undefined {
  if (isScalar(key) && typeof key.value === 'string') return key.value;
  if (typeof key === 'string') return key;
  return undefined;
}

function optionalString(map: YAMLMap, key: string): string | undefined {
  const v = map.get(key, true);
  if (isScalar(v) && typeof v.value === 'string') return v.value;
  if (typeof v === 'string') return v;
  return undefined;
}

function hasNonEmptyList(map: YAMLMap, key: string): boolean {
  const v = map.get(key, true);
  if (v && typeof v === 'object' && 'items' in v) {
    const items = (v as { items: unknown[] }).items;
    return Array.isArray(items) && items.length > 0;
  }
  return false;
}

function setStringField(
  map: YAMLMap,
  key: string,
  value: string | undefined,
): void {
  if (value === undefined) {
    if (map.has(key)) map.delete(key);
    return;
  }
  map.set(key, value);
}

function setBodyField(map: YAMLMap, body: string): void {
  map.set('body', makeBodyScalar(body));
}

function setParametersField(
  map: YAMLMap,
  parameters: ReadonlyArray<ParameterDeclaration> | undefined,
): void {
  if (parameters === undefined || parameters.length === 0) {
    if (map.has('parameters')) map.delete('parameters');
    return;
  }
  map.set('parameters', makeParametersSeq(parameters));
}

function makeParametersSeq(
  parameters: ReadonlyArray<ParameterDeclaration>,
): YAMLSeq {
  const seq = new YAMLSeq();
  seq.flow = false;
  for (const p of parameters) {
    const m = new YAMLMap();
    m.flow = false;
    for (const [k, v] of Object.entries(p)) {
      if (v !== undefined) m.set(k, v);
    }
    seq.add(m);
  }
  return seq;
}

function makeBodyScalar(body: string): Scalar {
  const node = new Scalar(body);
  node.type = Scalar.BLOCK_LITERAL;
  return node;
}
