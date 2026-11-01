/**
 * Worker-local batch sizing for already normalized events. Byte/count limits
 * alone do not protect Fabric's structural node budget for dense field-change
 * evidence. This does not change database validation or public atomic batches.
 */
import { DATABASE_OPERATION_MAX_NODES } from '../databases/database-operation-contracts';
import type { LoggingEvent } from './logging-contracts';

/** Leave bounded room for the registered command, input, key and actor framing. */
export const LOGGING_BATCH_MAX_NODES = DATABASE_OPERATION_MAX_NODES - 64;

/** Count the same scalar/container nodes as Fabric, after descriptor-safe event normalization. */
export function loggingEventNodes(event: LoggingEvent): number {
  const work: unknown[] = [event]; let count = 0;
  while (work.length) {
    const value = work.pop(); count++;
    if (value !== null && typeof value === 'object') work.push(...Object.values(value));
  }
  return count;
}
