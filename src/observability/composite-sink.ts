/**
 * composite-sink.ts
 *
 * Provides a fan-out sink that emits each platform event to multiple sinks.
 * This file owns sink composition only and deliberately ignores individual
 * sink failures so observability cannot break application behavior.
 */

import type { PlatformEvent, PlatformSink } from './types';

/** Fan-out sink for composing console, store, and custom adapters. */
export class CompositeSink implements PlatformSink {
  constructor(private readonly sinks: PlatformSink[]) {}

  /** Emit one event to every configured sink. */
  emit(event: PlatformEvent): void {
    for (const sink of this.sinks) {
      try {
        const result = sink.emit(event);
        if (result && typeof (result as Promise<void>).catch === 'function') {
          (result as Promise<void>).catch(() => {});
        }
      } catch {
        // Observability is best-effort by design.
      }
    }
  }
}
