import type { UseAuthApiKeysOptions } from '../../frontend/client/auth-api-key-hooks';
import type { ApiKeyManagementProps } from './api-key-management-types';

export interface ApiKeyManagementCopy {
  title: string;
  description: string;
  empty: string;
}

export interface ApiKeyManagementTerminology {
  readonly singular: string;
  readonly plural: string;
}

/** @internal Exact adapter between component modes and the SDK hook contract. */
export function apiKeyManagementHookOptions(
  props: ApiKeyManagementProps,
): UseAuthApiKeysOptions {
  const limit = boundedApiKeyPageSize(props.pageSize);
  if (props.mode === 'self') return { mode: 'self', limit };
  if (props.mode === 'application-admin') {
    return { mode: 'application-admin', userId: props.userId, limit };
  }
  if (props.mode === 'tenant-admin') {
    return { mode: 'tenant-admin', membershipId: props.membershipId, limit };
  }
  return props.membershipId
    ? {
        mode: 'platform-admin',
        tenantId: props.tenantId,
        membershipId: props.membershipId,
        limit,
      }
    : {
        mode: 'platform-admin',
        ...(props.tenantId ? { tenantId: props.tenantId } : {}),
        limit,
      };
}

export function apiKeyManagementCopy(
  props: ApiKeyManagementProps,
  terminology: ApiKeyManagementTerminology = {
    singular: 'organization',
    plural: 'organizations',
  },
): ApiKeyManagementCopy {
  const singular = terminology.singular.trim() || 'organization';
  const plural = terminology.plural.trim() || `${singular}s`;
  if (props.mode === 'self') {
    return {
      title: props.title ?? 'API keys',
      description: props.description
        ?? 'Create personal credentials that use your current live permissions.',
      empty: 'You do not have any API keys in this authorization scope.',
    };
  }
  if (props.mode === 'application-admin') {
    return {
      title: props.title ?? 'User API keys',
      description: props.description
        ?? 'Review and manage credentials issued for this application user.',
      empty: 'This application user does not have any API keys.',
    };
  }
  if (props.mode === 'tenant-admin') {
    return {
      title: props.title ?? 'Member API keys',
      description: props.description
        ?? `Review and manage credentials bound to this ${singular} member.`,
      empty: `This ${singular} member does not have any API keys.`,
    };
  }
  if (props.membershipId) {
    return {
      title: props.title ?? `${capitalize(singular)} member API keys`,
      description: props.description
        ?? `Review and manage credentials bound to this ${singular} member from the platform administration scope.`,
      empty: `This ${singular} member does not have any API keys.`,
    };
  }
  return {
    title: props.title ?? 'API key directory',
    description: props.description
      ?? `Review user API keys across ${plural} without exposing secrets.`,
    empty: 'No API keys match this platform view.',
  };
}

export function apiKeyManagementBoundaryTarget(props: ApiKeyManagementProps): string {
  if (props.mode === 'self') return 'self';
  if (props.mode === 'application-admin') return `application:${props.userId}`;
  if (props.mode === 'tenant-admin') return `tenant:${props.membershipId}`;
  return `platform:${props.tenantId ?? '*'}:${props.membershipId ?? '*'}`;
}

function boundedApiKeyPageSize(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 25;
  return Math.max(1, Math.min(100, Math.trunc(value)));
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
