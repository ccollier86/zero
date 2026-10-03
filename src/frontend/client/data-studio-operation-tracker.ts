/**
 * data-studio-operation-tracker.ts
 *
 * In-memory retry identity tracker for controller mutations. It serializes
 * retained ambiguous generations without owning transport or UI state.
 */

import {
  createDataStudioOperationId,
  isDataStudioMutationError,
} from './data-studio-client';

/**
 * Track mutation IDs outside React so retries after unknown outcomes cannot
 * accidentally create a second logical operation.
 */
export class DataStudioOperationTracker {
  private nextGeneration = 0;
  private readonly active = new Map<string, Map<string, number>>();
  private readonly retained = new Map<string, Array<{
    readonly operationId: string;
    readonly generation: number;
  }>>();

  begin(key: string): string {
    const retained = this.retained.get(key);
    const retry = retained?.shift();
    if (retained?.length === 0) this.retained.delete(key);
    const operationId = retry?.operationId ?? createDataStudioOperationId();
    const generation = retry?.generation ?? ++this.nextGeneration;
    const active = this.active.get(key) ?? new Map<string, number>();
    active.set(operationId, generation);
    this.active.set(key, active);
    return operationId;
  }

  succeed(key: string, operationId?: string): void {
    this.removeActive(key, operationId);
    this.removeRetained(key, operationId);
  }

  fail(key: string, error: unknown, operationId?: string): void {
    const id = operationId ?? (isDataStudioMutationError(error) ? error.operationId : undefined);
    if (!id) return;
    const generation = this.removeActive(key, id);
    if (isDataStudioMutationError(error) && error.requiresSameIdempotencyKey) {
      const retained = this.retained.get(key) ?? [];
      if (!retained.some((entry) => entry.operationId === id)) {
        retained.push({ operationId: id, generation: generation ?? ++this.nextGeneration });
        retained.sort((left, right) => left.generation - right.generation);
        this.retained.set(key, retained);
      }
    } else {
      this.removeRetained(key, id);
    }
  }

  clear(): void {
    this.active.clear();
    this.retained.clear();
  }

  private removeActive(key: string, operationId?: string): number | undefined {
    const active = this.active.get(key);
    if (!active) return undefined;
    const id = operationId ?? active.keys().next().value as string | undefined;
    if (!id) return undefined;
    const generation = active.get(id);
    active.delete(id);
    if (active.size === 0) this.active.delete(key);
    return generation;
  }

  private removeRetained(key: string, operationId?: string): void {
    const retained = this.retained.get(key);
    if (!retained) return;
    if (!operationId) retained.shift();
    else {
      const index = retained.findIndex((entry) => entry.operationId === operationId);
      if (index >= 0) retained.splice(index, 1);
    }
    if (retained.length === 0) this.retained.delete(key);
  }
}
