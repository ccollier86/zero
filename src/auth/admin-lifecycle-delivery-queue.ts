/**
 * Serializes administrator setup/reset delivery per store and user.
 *
 * Delivery spans an asynchronous provider call, so it cannot remain inside a
 * SQLite transaction. This process-local queue prevents concurrent successful
 * sends from predicting the same next security generation and invalidating
 * both emailed links.
 */

import type { UserStore } from './user-store';

const deliveryQueues = new WeakMap<UserStore, Map<string, Promise<void>>>();

/** Run one admin lifecycle delivery at a time for the selected user. */
export async function serializeAdminLifecycleDelivery<T>(
  store: UserStore,
  userId: string,
  deliver: () => Promise<T>
): Promise<T> {
  let queue = deliveryQueues.get(store);
  if (!queue) {
    queue = new Map();
    deliveryQueues.set(store, queue);
  }

  const previous = queue.get(userId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  queue.set(userId, current);

  await previous;
  try {
    return await deliver();
  } finally {
    release();
    if (queue.get(userId) === current) queue.delete(userId);
    if (queue.size === 0) deliveryQueues.delete(store);
  }
}
