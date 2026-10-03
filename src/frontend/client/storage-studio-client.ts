/**
 * storage-studio-client.ts
 *
 * Stable public facade for the browser Storage Studio SDK. Focused peers own
 * transport binding, mutation behavior, response parsing, and React state.
 */

export {
  STORAGE_STUDIO_API_PREFIX,
  createStorageStudioSdkSurface,
} from './storage-studio-surface';
export {
  StorageStudioMutationError,
  createStorageStudioOperationId,
  isStorageStudioMutationError,
} from './storage-studio-mutation';
export type {
  StorageStudioMutationFailureBody,
  StorageStudioMutationOptions,
  StorageStudioRequestOptions,
  StorageStudioSdkSurface,
} from './storage-studio-client-types';
