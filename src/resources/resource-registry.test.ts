/**
 * resource-registry.test.ts
 *
 * Verifies resource definition normalization and registration-time validation.
 * These tests do not generate routes or touch SQLite; CRUD/data/sync behavior
 * is covered by later resource integration slices.
 */

import { describe, expect, test } from 'bun:test';

import { resolveAuthBehaviorConfig } from '../auth/auth-config';
import {
  defineResource,
  isResourceDefinition,
} from './resource-definition';
import {
  ResourceRegistry,
  ResourceRegistryError,
  configureResourceRegistry,
  getResourceRegistry,
  validateResourceDefinitions,
} from './resource-registry';
import {
  adminOnly,
  metadataPolicy,
  ownerPolicy,
  readOnly,
} from './resource-policy-helpers';

const tables = {
  tickets: {
    ticket_id: 'text primary key',
    title: 'text not null',
    created_by: 'text not null',
  },
  projects: {
    id: 'text primary key',
    name: 'text not null',
  },
};

const authConfig = resolveAuthBehaviorConfig({
  userProperties: {
    department: {
      type: 'enum',
      values: ['support', 'management'],
      editableBy: 'admin',
      useInPolicies: true,
    },
    theme: {
      type: 'enum',
      values: ['light', 'dark'],
      editableBy: 'user',
    },
  },
});

describe('resource definitions and registry', () => {
  test('defineResource normalizes names, actions, and all-action policies', () => {
    const policy = readOnly();
    const resource = defineResource({
      table: 'tickets',
      actions: ['list', 'get'],
      policy,
    });

    expect(isResourceDefinition(resource)).toBe(true);
    expect(resource.name).toBe('tickets');
    expect(resource.actions).toEqual(['list', 'get']);
    expect(resource.policy.list).toBe(policy);
    expect(resource.policy.get).toBe(policy);
    expect(resource.policy.create).toBeUndefined();
  });

  test('registry resolves primary keys from table schema and exposes lookups', () => {
    const resource = defineResource({
      name: 'ticket',
      table: 'tickets',
      actions: ['list', 'get', 'create'],
      policy: {
        list: ownerPolicy({ userField: 'created_by' }),
        get: ownerPolicy({ userField: 'created_by' }),
        create: ownerPolicy({ userField: 'created_by' }),
      },
    });

    const registry = new ResourceRegistry();
    registry.register(resource, { tables, authConfig });

    expect(registry.list()).toHaveLength(1);
    expect(registry.get('ticket')?.primaryKey).toBe('ticket_id');
    expect(registry.getByTable('tickets')?.name).toBe('ticket');
    expect(registry.hasTable('tickets')).toBe(true);
  });

  test('configureResourceRegistry replaces the process registry', () => {
    const resource = defineResource({
      table: 'projects',
      actions: ['list', 'get'],
      policy: readOnly(),
    });

    const registry = configureResourceRegistry({
      resources: [resource],
      tables,
      authConfig,
    });

    expect(getResourceRegistry()).toBe(registry);
    expect(getResourceRegistry().getByTable('projects')?.primaryKey).toBe('id');
  });

  test('validation catches missing tables, mismatched primary keys, missing action policies, and metadata issues', () => {
    const invalid = [
      defineResource({
        table: 'missing',
        actions: ['list'],
        policy: readOnly(),
      }),
      defineResource({
        table: 'tickets',
        primaryKey: 'id',
        actions: ['list'],
        policy: readOnly(),
      }),
      defineResource({
        name: 'ticket-writes',
        table: 'tickets',
        actions: ['list', 'delete'],
        policy: {
          list: adminOnly(),
        },
      }),
      defineResource({
        name: 'theme-resource',
        table: 'projects',
        actions: ['list'],
        policy: metadataPolicy({ theme: 'dark' }),
      }),
    ];

    const issues = validateResourceDefinitions(invalid, { tables, authConfig });
    expect(issues.map((issue) => issue.code)).toContain('resource-table-missing');
    expect(issues.map((issue) => issue.code)).toContain('resource-primary-key-mismatch');
    expect(issues.map((issue) => issue.code)).toContain('resource-policy-missing');
    expect(issues.map((issue) => issue.code)).toContain('metadata-property-untrusted');
  });

  test('registry rejects duplicate resource names and tables', () => {
    const resources = [
      defineResource({
        name: 'ticket',
        table: 'tickets',
        actions: ['list'],
        policy: readOnly(),
      }),
      defineResource({
        name: 'ticket',
        table: 'projects',
        actions: ['list'],
        policy: readOnly(),
      }),
      defineResource({
        name: 'project-ticket',
        table: 'tickets',
        actions: ['list'],
        policy: readOnly(),
      }),
    ];

    expect(() =>
      new ResourceRegistry().register(resources, { tables, authConfig })
    ).toThrow(ResourceRegistryError);
  });
});
