import {
  parseDataRealmReadinessSnapshot,
  type DataRealmReadinessSdkSurface,
  type DataRealmReadinessSnapshot,
} from '../../auth/data-realm-readiness-types';
import type { FetchInit } from './sdk';

export const DATA_REALM_READINESS_PATH = '/auth/data-realm/readiness';
export const DATA_REALM_READINESS_RETRY_PATH =
  '/auth/data-realm/readiness/retry';

export type DataRealmReadinessFetch = (
  path: string,
  init?: FetchInit,
) => Promise<unknown>;

/** @internal Bind the readiness contract to Zero's authenticated HTTP path. */
export function createDataRealmReadinessSdkSurface(
  fetch: DataRealmReadinessFetch,
): DataRealmReadinessSdkSurface {
  return Object.freeze({
    async getReadiness(signal?: AbortSignal): Promise<DataRealmReadinessSnapshot> {
      const response = await fetch(DATA_REALM_READINESS_PATH, {
        method: 'GET',
        signal,
      });
      return parseDataRealmReadinessSnapshot(response);
    },
    async retry(signal?: AbortSignal): Promise<DataRealmReadinessSnapshot> {
      const response = await fetch(DATA_REALM_READINESS_RETRY_PATH, {
        method: 'POST',
        signal,
      });
      return parseDataRealmReadinessSnapshot(response);
    },
  });
}
