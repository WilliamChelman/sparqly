import { describe, expect, it } from 'vitest';
import { SourceStateEmitter } from './source-state-emitter';
import type { SourceTransition } from './source-state-event';

function loadStart(sourceId: string): SourceTransition {
  return { kind: 'load-start', sourceId };
}

function loadSuccess(sourceId: string): SourceTransition {
  return { kind: 'load-success', sourceId };
}

describe('SourceStateEmitter (#354)', () => {
  it('emit reaches a subscriber registered before the emit', () => {
    const emitter = new SourceStateEmitter();
    const received: SourceTransition[] = [];
    emitter.subscribe((t) => received.push(t));
    emitter.emit(loadStart('a'));
    expect(received).toEqual([loadStart('a')]);
  });

  it('emit fan-outs to every subscriber', () => {
    const emitter = new SourceStateEmitter();
    const a: SourceTransition[] = [];
    const b: SourceTransition[] = [];
    emitter.subscribe((t) => a.push(t));
    emitter.subscribe((t) => b.push(t));
    emitter.emit(loadStart('src'));
    expect(a).toEqual([loadStart('src')]);
    expect(b).toEqual([loadStart('src')]);
  });

  it('unsubscribe stops further delivery to that listener only', () => {
    const emitter = new SourceStateEmitter();
    const a: SourceTransition[] = [];
    const b: SourceTransition[] = [];
    const offA = emitter.subscribe((t) => a.push(t));
    emitter.subscribe((t) => b.push(t));
    emitter.emit(loadStart('src'));
    offA();
    emitter.emit(loadSuccess('src'));
    expect(a.map((t) => t.kind)).toEqual(['load-start']);
    expect(b.map((t) => t.kind)).toEqual(['load-start', 'load-success']);
  });

  it('preserves emit order across all subscribers under interleaved emits', () => {
    // The SSE wiring relies on this: every subscriber must observe the
    // same sequence in the same order — otherwise the ring buffer's
    // recorded order can drift from a live subscriber's view, and a
    // reconnect replay would produce a state the live stream never did.
    const emitter = new SourceStateEmitter();
    const a: string[] = [];
    const b: string[] = [];
    emitter.subscribe((t) => a.push(`${t.sourceId}:${t.kind}`));
    emitter.subscribe((t) => b.push(`${t.sourceId}:${t.kind}`));
    emitter.emit(loadStart('x'));
    emitter.emit(loadSuccess('x'));
    emitter.emit(loadStart('y'));
    emitter.emit(loadSuccess('y'));
    expect(a).toEqual(['x:load-start', 'x:load-success', 'y:load-start', 'y:load-success']);
    expect(b).toEqual(a);
  });

  it("a throwing listener does not break delivery to siblings", () => {
    const errors: unknown[] = [];
    const emitter = new SourceStateEmitter({
      onListenerError: (e) => errors.push(e),
    });
    const downstream: SourceTransition[] = [];
    emitter.subscribe(() => {
      throw new Error('boom');
    });
    emitter.subscribe((t) => downstream.push(t));
    emitter.emit(loadStart('src'));
    expect(downstream).toEqual([loadStart('src')]);
    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe('boom');
  });
});
