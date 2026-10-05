/** Same-service per-index write ordering and awaited operation drain. */

import { VectorError } from './vector-error';

const MAX_ACTIVE_OPERATIONS = 1_024;
const MAX_WRITES_PER_INDEX = 128;

/**
 * Includes ordinary writes/deletes, not merely a scoped fetch/check mutex.
 * Independent indexes remain concurrent. This is not distributed atomicity
 * across services/adapters/processes or a native multi-record transaction.
 */
export class VectorOperationBoundary {
  private readonly writes = new Map<string, Promise<void>>();
  private readonly active = new Set<Promise<void>>();
  private readonly writeCounts = new Map<string, number>();
  private accepting = true;
  private drain: Promise<void> | null = null;

  read<T>(operation: () => Promise<T>): Promise<T> {
    return this.admit(Promise.resolve(), operation);
  }

  write<T>(index: string, operation: () => Promise<T>): Promise<T> {
    try { this.assertWriteAdmission(index); }
    catch (error) { return Promise.reject(error); }
    const result = this.admit(this.writes.get(index) ?? Promise.resolve(), operation);
    this.writeCounts.set(index, (this.writeCounts.get(index) ?? 0) + 1);
    const release = (): void => {
      const remaining = this.writeCounts.get(index)! - 1;
      if (remaining === 0) this.writeCounts.delete(index);
      else this.writeCounts.set(index, remaining);
    };
    const settled = result.then(release, release);
    this.writes.set(index, settled);
    void settled.then(() => {
      if (this.writes.get(index) === settled) this.writes.delete(index);
    });
    return result;
  }

  close(): Promise<void> {
    this.accepting = false;
    return this.drain ??= Promise.all([...this.active]).then(() => undefined);
  }

  /** Internal test/diagnostic accounting, intentionally not a package export. */
  get pendingIndexes(): number { return this.writes.size; }

  /** Cheap synchronous preflight before copying caller-owned write payloads. */
  assertWriteAdmission(index: string): void {
    this.assertAdmission();
    if ((this.writeCounts.get(index) ?? 0) >= MAX_WRITES_PER_INDEX) {
      throw backpressure('index');
    }
  }

  private assertAdmission(): void {
    if (!this.accepting) throw new VectorError('VECTOR_OPERATION_FAILED', 'Vector service is closed.');
    if (this.active.size >= MAX_ACTIVE_OPERATIONS) throw backpressure('service');
  }

  private admit<T>(prior: Promise<void>, operation: () => Promise<T>): Promise<T> {
    try { this.assertAdmission(); }
    catch (error) { return Promise.reject(error); }
    const result = prior.then(operation);
    let settled: Promise<void>;
    const release = (): void => { this.active.delete(settled); };
    settled = result.then(release, release);
    this.active.add(settled);
    return result;
  }
}

function backpressure(capacity: 'index' | 'service'): VectorError {
  return new VectorError('VECTOR_BACKPRESSURE', 'Vector operation capacity is exhausted.', { capacity });
}
