/**
 * Process-local publication for composed workflow plugin runtimes.
 *
 * A registry, ready service, and shutdown function are one ownership unit.
 * Keeping them in a single record prevents process-wide compatibility getters
 * from ever combining state from two independently composed applications.
 */

import type { WorkflowRegistry } from './workflow-registry';
import type { WorkflowService } from './workflow-service';

export interface PublishedWorkflowRuntimeOwner {
  readonly registry: WorkflowRegistry;
  service: WorkflowService | null;
  /** Failed owners stay addressable for cleanup but expose no usable runtime. */
  visible: boolean;
  readonly stop: () => Promise<void>;
}

const owners: PublishedWorkflowRuntimeOwner[] = [];

/** Publish one composed owner and return an identity-scoped unpublisher. */
export function publishWorkflowRuntimeOwner(
  owner: PublishedWorkflowRuntimeOwner,
): () => void {
  owners.push(owner);
  let published = true;

  return () => {
    if (!published) return;
    published = false;
    const index = owners.lastIndexOf(owner);
    if (index >= 0) owners.splice(index, 1);
  };
}

/** Most recently composed owner that has not been stopped. */
export function getCurrentWorkflowRuntimeOwner(): PublishedWorkflowRuntimeOwner | null {
  return owners.at(-1) ?? null;
}
