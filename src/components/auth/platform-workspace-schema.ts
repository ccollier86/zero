/**
 * platform-workspace-schema.ts
 *
 * Presentation schema and row mapping for the platform workspace directory.
 * The protected platform SDK remains the source of truth for persistence.
 */

import type { AuthPlatformTenant } from '../../frontend/client/auth-platform-administration-types';
import { defineSchema, field } from '../../schema';
import type { Row } from '../../sync/types';

/** Row rendered by the platform workspace master/detail surface. */
export interface PlatformWorkspaceRow extends AuthPlatformTenant, Row {}

export const platformWorkspaceSchema = defineSchema({
  name: field.text({ label: 'Name', required: true }),
  slug: field.text({ label: 'URL name', required: true }),
  status: field.select([
    { value: 'active', label: 'Active' },
    { value: 'suspended', label: 'Suspended' },
    { value: 'archived', label: 'Archived' },
  ], { label: 'Status', required: true }),
  activeMemberCount: field.number({ label: 'Active members', integer: true }),
  memberCount: field.number({ label: 'Members', integer: true }),
}, { pk: 'tenantId' });

export const platformWorkspaceListColumns = [
  'name',
  'slug',
  'status',
  'activeMemberCount',
];

/** Preserve the SDK projection while satisfying the generic table row contract. */
export function toPlatformWorkspaceRows(
  tenants: readonly AuthPlatformTenant[],
): PlatformWorkspaceRow[] {
  return tenants.map((tenant) => ({ ...tenant }));
}
