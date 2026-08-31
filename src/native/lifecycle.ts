/** Orders credential commits and invalidates work superseded by sign-out/login. */

import { NativeAuthError } from './errors';

export class NativeLifecycle {
  private generation = 0;
  private commitTail: Promise<void> = Promise.resolve();

  capture(): number {
    return this.generation;
  }

  supersede(): number {
    this.generation += 1;
    return this.generation;
  }

  isCurrent(generation: number): boolean {
    return generation === this.generation;
  }

  assertCurrent(generation: number): void {
    if (!this.isCurrent(generation)) throw supersededOperation();
  }

  commit<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.commitTail.then(operation, operation);
    this.commitTail = pending.then(() => undefined, () => undefined);
    return pending;
  }
}

export function supersededOperation(): NativeAuthError {
  return new NativeAuthError(
    'Native authentication operation was superseded.',
    'NATIVE_OPERATION_SUPERSEDED',
  );
}

export function isSupersededOperation(error: unknown): boolean {
  return error instanceof NativeAuthError && error.code === 'NATIVE_OPERATION_SUPERSEDED';
}
