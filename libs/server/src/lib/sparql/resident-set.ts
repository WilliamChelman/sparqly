/**
 * Per-worker LRU-bounded resident set (ADR-0050, amends ADR-0031). Holds the
 * built stores a query worker memoizes, capped by a quad budget. When a `set`
 * pushes the resident total over budget the least-recently-used *idle* entry is
 * evicted; the soft governor yields to the `resourceLimits` hard ceiling, so it
 * never evicts a pinned (in-flight-query) entry nor the entry just inserted.
 * Recency is insertion order in the backing `Map`, refreshed on every `get`.
 */
export class ResidentSet<T extends { quads: number }> {
  private readonly entries = new Map<string, T>();
  /** Pin depth per id — an entry is unevictable while it has ≥1 in-flight query. */
  private readonly pins = new Map<string, number>();

  constructor(private readonly maxQuads: number) {}

  /** Inserts (or refreshes) `id` as most-recently-used, then evicts LRU idle
   * entries until the resident total fits the budget. Returns the evicted ids. */
  set(id: string, value: T): string[] {
    this.entries.delete(id);
    this.entries.set(id, value);
    return this.enforceBudget(id);
  }

  /** Returns the entry and marks it most-recently-used, or `undefined`. */
  get(id: string): T | undefined {
    const value = this.entries.get(id);
    if (value === undefined) return undefined;
    this.entries.delete(id);
    this.entries.set(id, value);
    return value;
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  /** Pins `id` so it survives eviction while a query runs against it. */
  pin(id: string): void {
    this.pins.set(id, (this.pins.get(id) ?? 0) + 1);
  }

  /** Releases one pin; the entry becomes evictable again at zero depth. */
  unpin(id: string): void {
    const depth = this.pins.get(id);
    if (depth === undefined) return;
    if (depth <= 1) this.pins.delete(id);
    else this.pins.set(id, depth - 1);
  }

  private enforceBudget(justSet: string): string[] {
    const evicted: string[] = [];
    let total = 0;
    for (const value of this.entries.values()) total += value.quads;
    for (const [id, value] of this.entries) {
      if (total <= this.maxQuads) break;
      if (id === justSet) continue;
      if (this.pins.has(id)) continue;
      this.entries.delete(id);
      total -= value.quads;
      evicted.push(id);
    }
    return evicted;
  }
}
