import {
  Document,
  isMap,
  isScalar,
  parseDocument,
  Scalar,
  YAMLMap,
} from 'yaml';
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
  return entry;
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
    return { created: false };
  }
  const newMap = new YAMLMap();
  if (entry.description !== undefined) {
    newMap.set('description', entry.description);
  }
  newMap.set('body', makeBodyScalar(entry.body));
  root.set(entry.slug, newMap);
  return { created: true };
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

function makeBodyScalar(body: string): Scalar {
  const node = new Scalar(body);
  node.type = Scalar.BLOCK_LITERAL;
  return node;
}
