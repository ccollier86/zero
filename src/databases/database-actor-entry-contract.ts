/**
 * database-actor-entry-contract.ts
 *
 * Shared, side-effect-free validation for the private same-entry actor
 * invocation. Keeping this contract separate prevents the parent command
 * builder and child bootstrap from drifting apart.
 */

import { types as utilTypes } from 'node:util';

import type { DatabaseActorRole } from './database-actor-protocol';
import { DatabaseError } from './database-error';

/** Private marker appended to a Zero application command for actor children. */
export const DATABASE_ACTOR_CHILD_FLAG = '--zero-db-child' as const;

const ACTOR_FLAG_PATTERN = /^--[a-z][a-z0-9-]{0,62}$/u;
const ACTOR_SLOT_PATTERN = /^(?:0|[1-9][0-9]{0,15})$/u;
const MAX_ARGUMENT_COUNT = 1_024;
const MAX_ARGUMENT_BYTES = 16_384;
const textEncoder = new TextEncoder();

/** Parsed private invocation. The prefix is deliberately not retained. */
export interface DatabaseActorInvocation {
  readonly role: DatabaseActorRole;
  readonly slot: number;
}

/** Validate a configurable private actor marker without reflecting its value. */
export function normalizeDatabaseActorFlag(value: unknown): string {
  if (typeof value !== 'string' || !ACTOR_FLAG_PATTERN.test(value)) {
    throw invalidActorConfiguration();
  }
  return value;
}

/**
 * Parse an actor invocation only when its exact marker is present.
 *
 * The marker must occur once and occupy the third position from the end. This
 * lets both source entries (`bun app.ts ...`) and compiled entries (`app ...`)
 * retain their executable prefix while preventing trailing application flags
 * from being interpreted in actor mode.
 */
export function parseDatabaseActorInvocation(
  argv: readonly string[],
  actorFlag: string = DATABASE_ACTOR_CHILD_FLAG,
): DatabaseActorInvocation | null {
  const normalizedFlag = normalizeDatabaseActorFlag(actorFlag);
  const args = cloneStringVector(argv);
  const markerIndexes: number[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === normalizedFlag) markerIndexes.push(index);
  }
  if (markerIndexes.length === 0) return null;
  if (markerIndexes.length !== 1
    || markerIndexes[0] !== args.length - 3) {
    throw invalidActorInvocation();
  }

  const role = args[args.length - 2];
  const rawSlot = args[args.length - 1];
  if ((role !== 'writer' && role !== 'reader')
    || rawSlot === undefined
    || !ACTOR_SLOT_PATTERN.test(rawSlot)) {
    throw invalidActorInvocation();
  }
  const slot = Number(rawSlot);
  if (!Number.isSafeInteger(slot) || slot < 0) {
    throw invalidActorInvocation();
  }
  return Object.freeze({ role, slot });
}

function cloneStringVector(value: unknown): readonly string[] {
  if (!Array.isArray(value)
    || utilTypes.isProxy(value)
    || value.length > MAX_ARGUMENT_COUNT) {
    throw invalidActorInvocation();
  }
  try {
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw invalidActorInvocation();
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Object.keys(descriptors).filter((key) => key !== 'length');
    if (keys.length !== value.length) throw invalidActorInvocation();

    const result: string[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor
        || !descriptor.enumerable
        || !('value' in descriptor)
        || typeof descriptor.value !== 'string'
        || descriptor.value.includes('\0')
        || textEncoder.encode(descriptor.value).byteLength > MAX_ARGUMENT_BYTES) {
        throw invalidActorInvocation();
      }
      result.push(descriptor.value);
    }
    return Object.freeze(result);
  } catch (error) {
    if (error instanceof DatabaseError) throw error;
    throw invalidActorInvocation();
  }
}

function invalidActorConfiguration(): DatabaseError {
  return new DatabaseError(
    'DATABASE_CONFIG_INVALID',
    'Database actor launch configuration is invalid.',
  );
}

function invalidActorInvocation(): DatabaseError {
  return new DatabaseError(
    'DATABASE_CONFIG_INVALID',
    'Invalid database actor invocation.',
  );
}
