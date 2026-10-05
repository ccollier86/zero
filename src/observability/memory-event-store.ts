/**
 * memory-event-store.ts
 *
 * Provides the default bounded in-memory event store used by Zero's
 * observability endpoint. This store owns retention and querying only; it does
 * not format output or export events to external services.
 */

import type {
  PlatformEvent,
  PlatformEventPage,
  PlatformEventQuery,
  PlatformEventStore,
  PlatformEventLevel,
} from './types';
import { ObservabilityConfigurationError } from './configuration-error';

/** Bounded in-memory event store. */
export class MemoryEventStore implements PlatformEventStore {
  private events: PlatformEvent[] = [];
  private readonly maxEvents: number;

  constructor(options: { maxEvents?: number } = {}) {
    const maxEvents = options.maxEvents ?? 1000;
    if (!Number.isSafeInteger(maxEvents) || maxEvents <= 0) {
      throw new ObservabilityConfigurationError('Observability maxEvents must be a positive safe integer');
    }
    this.maxEvents = maxEvents;
  }

  /** Store one event and prune old events past the retention limit. */
  emit(event: PlatformEvent): void {
    this.events.push(event);
    if (this.events.length > this.maxEvents) {
      this.events.splice(0, this.events.length - this.maxEvents);
    }
  }

  /** Query stored events from oldest to newest. */
  query(options: PlatformEventQuery = {}): PlatformEventPage {
    const limit = clampLimit(options.limit);
    const levels = normalizeLevels(options.level);
    let filtered = this.events.filter((event) => {
      if (options.cursor !== undefined && event.sequence <= options.cursor) return false;
      if (options.since !== undefined && event.timestamp < options.since) return false;
      if (levels && !levels.has(event.level)) return false;
      if (options.category && event.category !== options.category) return false;
      if (options.code && event.code !== options.code) return false;
      if (options.source && event.source !== options.source) return false;
      return true;
    });

    if (filtered.length > limit) filtered = filtered.slice(filtered.length - limit);

    const last = filtered[filtered.length - 1];
    return {
      events: filtered,
      count: filtered.length,
      nextCursor: last ? last.sequence : null,
    };
  }

  /** Clear all stored events. */
  clear(): void {
    this.events = [];
  }
}

function clampLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit ?? 0) || !limit) return 100;
  return Math.min(Math.max(Math.floor(limit), 1), 1000);
}

function normalizeLevels(level: PlatformEventLevel | PlatformEventLevel[] | undefined): Set<PlatformEventLevel> | null {
  if (!level) return null;
  return new Set(Array.isArray(level) ? level : [level]);
}
