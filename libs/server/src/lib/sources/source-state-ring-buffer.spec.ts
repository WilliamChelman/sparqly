import { describe, expect, it } from 'vitest';
import { SourceStateRingBuffer } from './source-state-ring-buffer';
import type { SourceTransitionEvent } from './source-state-event';

function row(id: string, state: 'not-loaded' | 'loading' | 'loaded') {
  return {
    mode: 'in-memory' as const,
    id,
    kind: 'empty' as const,
    state,
  };
}

function transition(
  sourceId: string,
  state: 'not-loaded' | 'loading' | 'loaded',
): Omit<SourceTransitionEvent, 'id'> {
  return { sourceId, row: row(sourceId, state) };
}

describe('SourceStateRingBuffer (#354)', () => {
  it('append returns events with monotonically-increasing ids starting at 1', () => {
    const buffer = new SourceStateRingBuffer();
    const a = buffer.append(transition('a', 'loading'));
    const b = buffer.append(transition('a', 'loaded'));
    const c = buffer.append(transition('b', 'loading'));
    expect([a.id, b.id, c.id]).toEqual([1, 2, 3]);
  });

  it('drops the oldest events once capacity is exceeded', () => {
    const buffer = new SourceStateRingBuffer({ capacity: 3 });
    buffer.append(transition('a', 'loading')); // id 1 — should be evicted
    buffer.append(transition('a', 'loaded')); // id 2 — should be evicted
    buffer.append(transition('b', 'loading')); // id 3
    buffer.append(transition('b', 'loaded')); // id 4
    buffer.append(transition('c', 'loading')); // id 5
    const result = buffer.since(0);
    expect(result.kind).toBe('events');
    if (result.kind === 'events') {
      expect(result.events.map((e) => e.id)).toEqual([3, 4, 5]);
    }
  });

  it('since(lastId) returns events strictly after lastId, in append order', () => {
    const buffer = new SourceStateRingBuffer();
    buffer.append(transition('a', 'loading')); // id 1
    buffer.append(transition('a', 'loaded')); // id 2
    buffer.append(transition('b', 'loading')); // id 3
    const result = buffer.since(1);
    expect(result.kind).toBe('events');
    if (result.kind === 'events') {
      expect(result.events.map((e) => e.id)).toEqual([2, 3]);
      expect(result.events.map((e) => e.sourceId)).toEqual(['a', 'b']);
    }
  });

  it('since(lastId) returns the overflow sentinel when lastId falls below the buffer horizon', () => {
    const buffer = new SourceStateRingBuffer({ capacity: 2 });
    buffer.append(transition('a', 'loading')); // id 1 — evicted
    buffer.append(transition('a', 'loaded')); // id 2 — evicted
    buffer.append(transition('b', 'loading')); // id 3
    buffer.append(transition('b', 'loaded')); // id 4
    // Client last saw id 1; the buffer's oldest is now id 3 — the gap
    // includes evicted id 2, so a full replay is impossible.
    expect(buffer.since(1).kind).toBe('overflow');
    // A reconnect at exactly the buffer's oldest-1 is still bridgeable.
    expect(buffer.since(2).kind).toBe('events');
  });

  it('since(0) on a fresh buffer is an empty events result (not overflow)', () => {
    // The client's very first connection sends Last-Event-ID: 0 implicitly
    // (no header) — that's "give me everything", and an empty buffer
    // satisfies it without a forced snapshot refetch.
    const buffer = new SourceStateRingBuffer({ capacity: 2 });
    const result = buffer.since(0);
    expect(result).toEqual({ kind: 'events', events: [] });
  });

  it('since(latestId) is an empty events result — client is fully caught up', () => {
    const buffer = new SourceStateRingBuffer();
    buffer.append(transition('a', 'loading'));
    buffer.append(transition('a', 'loaded'));
    const result = buffer.since(2);
    expect(result).toEqual({ kind: 'events', events: [] });
  });

  it('latestId() reports the most recent assigned id, or 0 when empty', () => {
    const buffer = new SourceStateRingBuffer();
    expect(buffer.latestId()).toBe(0);
    buffer.append(transition('a', 'loading'));
    buffer.append(transition('a', 'loaded'));
    expect(buffer.latestId()).toBe(2);
  });
});
