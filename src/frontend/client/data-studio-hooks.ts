'use client';

/**
 * data-studio-hooks.ts
 *
 * Stable public façade for the browser-facing Data Studio React controller.
 */

export { useDataStudio } from './data-studio-controller';
export {
  resolveDataStudioAccess,
  type DataStudioAccess,
  type DataStudioControllerStatus,
  type UseDataStudioOptions,
  type UseDataStudioResult,
} from './data-studio-controller-types';
export { DataStudioOperationTracker } from './data-studio-operation-tracker';
