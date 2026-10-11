/** Explicit public playback; fixtures never execute AI, vector writes or authenticated requests. */
import type { VectorVisualizationAdapter, VectorVisualizationSnapshot } from '../../vector/visualization-types';
import { parseVectorVisualizationSnapshot } from './vector-visualization-client';
export interface VectorVisualizationStoryFrame { atMs: number; snapshot: VectorVisualizationSnapshot; }
export interface VectorVisualizationStory extends VectorVisualizationAdapter {
  play(): void; pause(): void; seek(atMs: number): void; dispose(): void;
}
export function createVectorVisualizationStory(frames: readonly VectorVisualizationStoryFrame[], options: { loop?: boolean; speed?: number } = {}): VectorVisualizationStory {
  const speed = options.speed ?? 1;
  if (!frames.length || frames.length > 256 || !Number.isFinite(speed) || speed <= 0 || speed > 10) throw new Error('Invalid visualization story.');
  let previous = -1; let identity: { id: string; index: string; kind: VectorVisualizationSnapshot['kind'] } | undefined;
  const checked = frames.map(frame => {
    if (!Number.isFinite(frame.atMs) || frame.atMs < 0 || frame.atMs <= previous || frame.atMs > 600000) throw new Error('Invalid story timing.'); previous = frame.atMs;
    if (!parseVectorVisualizationSnapshot(frame.snapshot)) throw new Error('Invalid story snapshot.');
    const snapshot = parseVectorVisualizationSnapshot(JSON.parse(JSON.stringify(frame.snapshot)))!;
    identity ??= { id: snapshot.id, index: snapshot.index, kind: snapshot.kind };
    if (snapshot.id !== identity.id || snapshot.index !== identity.index || snapshot.kind !== identity.kind) throw new Error('Story frames must describe one operation.');
    return { atMs: frame.atMs, snapshot };
  });
  const duration = checked.at(-1)!.atMs, id = identity!.id;
  const listeners = new Set<(snapshot: VectorVisualizationSnapshot | null) => void>();
  let current = 0, clock = 0, start = 0, timer: ReturnType<typeof setTimeout> | null = null, disposed = false, revision = 1;
  let snapshot = { ...checked[0]!.snapshot, revision };
  const now = () => typeof performance === 'undefined' ? Date.now() : performance.now();
  const publish = () => { snapshot = { ...checked[current]!.snapshot, revision: ++revision }; for (const listener of listeners) listener(snapshot); };
  const frameAt = (atMs: number) => { let result = 0; for (let i = 0; i < checked.length; i++) { if (checked[i]!.atMs > atMs) break; result = i; } return result; };
  const seek = (atMs: number) => { if (disposed || !Number.isFinite(atMs)) return;
    clock = Math.max(0, Math.min(duration, atMs)); current = frameAt(clock); publish(); };
  const pause = () => { if (timer !== null) { clearTimeout(timer); timer = null; clock = Math.min(duration, clock + (now() - start) * speed); } };
  const tick = () => { if (disposed) return;
    const time = clock + (now() - start) * speed;
    if (time >= duration) { seek(duration); timer = null; if (options.loop && duration > 0) { clock = 0; play(); } return; }
    const index = frameAt(time);
    if (index !== current) { current = index; publish(); }
    timer = setTimeout(tick, 16);
  };
  const play = () => { if (disposed || timer !== null) return; if (clock >= duration) clock = 0; start = now(); timer = setTimeout(tick, 0); };
  return { get: async requested => requested === id && !disposed ? snapshot : null,
    subscribe(requested, listener) { if (requested !== id || disposed) { listener(null); return () => {}; }
      listeners.add(listener); listener(snapshot); return () => { listeners.delete(listener); }; },
    play, pause, seek(atMs) { const playing = timer !== null; pause(); seek(atMs); if (playing) play(); },
    dispose() { pause(); disposed = true; listeners.clear(); } };
}
