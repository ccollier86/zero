/** Debounced development snapshots: immediately retire old admission, atomically publish complete replacements. */
import { watch, type FSWatcher } from 'node:fs';
import type { DocsSnapshot } from './types';

export interface DocsSnapshotRuntime {
  readonly current: () => DocsSnapshot | null;
  readonly generation: () => number;
  readonly dispose: () => Promise<void>;
}
export async function createDocsSnapshotRuntime(options: {
  initial: DocsSnapshot; watchRoot?: string; compile?: () => Promise<DocsSnapshot>; failed?: () => void;
}): Promise<DocsSnapshotRuntime> {
  let current: DocsSnapshot | null = options.initial, generation = 0, disposed = false;
  let watcher: FSWatcher | undefined, timer: ReturnType<typeof setTimeout> | undefined, work: Promise<void> | undefined, again = false;
  let drain: Promise<void> | undefined;
  const rebuild = async () => {
    if (disposed || !options.compile) return;
    if (work) { again = true; return work; }
    const admittedGeneration = generation;
    work = (async () => {
      try { const snapshot = await options.compile!(); if (!disposed && generation === admittedGeneration) current = snapshot; }
      catch { if (!disposed && generation === admittedGeneration) { current = null; options.failed?.(); } }
    })();
    await work; work = undefined;
    if (again && !disposed) { again = false; await rebuild(); }
  };
  const changed = () => {
    if (disposed) return;
    generation++; current = null; if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = undefined; void rebuild(); }, 80);
  };
  if (options.watchRoot && options.compile) {
    try { watcher = watch(options.watchRoot, { recursive: true }, changed); watcher.on('error', () => { generation++; current = null; options.failed?.(); }); }
    catch { current = null; options.failed?.(); throw new Error('Documentation watching could not start.'); }
    // Build and setup are different lifecycle boundaries; re-admit under the installed watcher.
    generation++; current = null; await rebuild();
  }
  return Object.freeze({ current: () => current, generation: () => generation,
    dispose() {
      if (drain) return drain; disposed = true; generation++; current = null;
      if (timer) clearTimeout(timer); watcher?.close(); drain = Promise.resolve(work).then(() => undefined); return drain;
    } });
}
