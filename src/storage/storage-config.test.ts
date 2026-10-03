/**
 * storage-config.test.ts
 *
 * Locks strict, immutable Storage Studio config normalization.
 */

import { describe, expect, test } from 'bun:test';
import {
  resolveAppStorageConfig,
  resolveStorageStudioConfig,
} from './storage-config';

describe('Storage Studio config', () => {
  test('is disabled and conservative by default', () => {
    const config = resolveAppStorageConfig(undefined, {});

    expect(config).toMatchObject({
      defaultPresignedTTL: 3_600,
      studio: {
        enabled: false,
        organizationDrives: true,
        personalDrives: false,
        personalSelfService: false,
        isolation: 'shared-cas',
        maxCapabilityTTL: 3_600,
        defaultGrants: [],
        publicAccess: {
          allowPublicDrives: false,
          allowPublicObjects: false,
        },
        limits: {
          maxOrganizationDrives: 100,
          maxPersonalDrivesPerUser: 10,
          maxObjectsPerDrive: 0,
          defaultDriveSizeBytes: 0,
          defaultFileSizeBytes: 0,
          maxDriveSizeBytes: 0,
          maxFileSizeBytes: 0,
          maxConcurrentUploadBytes: 0,
        },
      },
    });
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.studio)).toBe(true);
    expect(Object.isFrozen(config.studio.limits)).toBe(true);
    expect(Object.isFrozen(config.studio.publicAccess)).toBe(true);
    expect(Object.isFrozen(config.studio.defaultGrants)).toBe(true);
  });

  test('normalizes a complete policy and deeply freezes grants', () => {
    const config = resolveAppStorageConfig({
      defaultPresignedTTL: 600,
      studio: {
        enabled: true,
        organizationDrives: true,
        personalDrives: true,
        personalSelfService: true,
        isolation: 'shared-cas',
        maxCapabilityTTL: 900,
        defaultGrants: [{
          grantType: 'property',
          grantKey: 'department.code',
          grantValue: 'records',
          permission: 'write',
        }],
        limits: {
          maxOrganizationDrives: 12,
          maxPersonalDrivesPerUser: 2,
          maxObjectsPerDrive: 5_000,
          defaultDriveSizeBytes: 1_000_000,
          defaultFileSizeBytes: 100_000,
          maxDriveSizeBytes: 5_000_000,
          maxFileSizeBytes: 500_000,
          maxConcurrentUploadBytes: 750_000,
        },
        publicAccess: {
          allowPublicDrives: true,
          allowPublicObjects: true,
        },
      },
    }, {});

    expect(config.studio).toMatchObject({
      enabled: true,
      personalSelfService: true,
      isolation: 'shared-cas',
      maxCapabilityTTL: 900,
    });
    expect(config.studio.defaultGrants[0]).toEqual({
      grantType: 'property',
      grantKey: 'department.code',
      grantValue: 'records',
      permission: 'write',
    });
    expect(Object.isFrozen(config.studio.defaultGrants[0])).toBe(true);
  });

  test('rejects unknown and internally inconsistent policy', () => {
    expect(() => resolveStorageStudioConfig({
      enabled: true,
      typo: true,
    } as never)).toThrow('storage.studio.typo is not a supported setting');

    expect(() => resolveStorageStudioConfig({
      enabled: true,
      organizationDrives: false,
      personalDrives: false,
    })).toThrow('must enable organizationDrives or personalDrives');

    expect(() => resolveStorageStudioConfig({
      personalSelfService: true,
    })).toThrow('personalSelfService requires personalDrives');

    expect(() => resolveStorageStudioConfig({
      enabled: true,
      publicAccess: {
        allowPublicDrives: true,
        allowPublicObjects: false,
      },
    })).toThrow('allowPublicDrives requires allowPublicObjects');

    expect(() => resolveStorageStudioConfig({
      enabled: true,
      limits: {
        defaultFileSizeBytes: 20,
        defaultDriveSizeBytes: 10,
      },
    })).toThrow('defaultFileSizeBytes must not exceed defaultDriveSizeBytes');
  });

  test('enforces the maximum capability lifetime during strict normalization', () => {
    expect(() => resolveAppStorageConfig({
      defaultPresignedTTL: 1_000,
      studio: { enabled: true, maxCapabilityTTL: 500 },
    }, {})).toThrow('defaultPresignedTTL must not exceed');

    expect(() => resolveAppStorageConfig({
      defaultPresignedTTL: 1_000,
      studio: { maxCapabilityTTL: 500 },
    }, {})).toThrow('defaultPresignedTTL must not exceed');
  });

  test('rejects malformed and duplicate default grants', () => {
    expect(() => resolveStorageStudioConfig({
      defaultGrants: [{
        grantType: 'role',
        grantKey: 'forbidden',
        grantValue: 'editor',
        permission: 'write',
      }],
    })).toThrow('grantKey is valid only for property grants');

    const grant = {
      grantType: 'role' as const,
      grantValue: 'editor',
      permission: 'write' as const,
    };
    expect(() => resolveStorageStudioConfig({
      defaultGrants: [grant, { ...grant }],
    })).toThrow('duplicates an earlier default grant');
  });
});
