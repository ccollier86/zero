/** ReactiveDB registration schemas for framework-owned Guardian anchors. */

import type { GuardianReferenceKind } from '../schema/guardian-references';
import type { TableSchema } from '../sync/types';

const EMPTY_REACTIVE_ANCHOR_TABLES = Object.freeze({});
const USER_REACTIVE_ANCHOR_TABLES = Object.freeze({
  users: Object.freeze({
    user_id: 'text primary key',
  } satisfies TableSchema),
});
const MEMBERSHIP_REACTIVE_ANCHOR_TABLES = Object.freeze({
  ...USER_REACTIVE_ANCHOR_TABLES,
  tenant_memberships: Object.freeze({
    membership_id: 'text primary key',
    tenant_id: 'text not null',
    user_id: 'text not null references users(user_id) on delete restrict',
  } satisfies TableSchema),
});

/**
 * Return only the ID-only Guardian anchors one actor realm requires.
 *
 * The schemas register already-validated framework tables with ReactiveDB;
 * they never enter the app realm catalog, checksum, or operation surface.
 */
export function identityAnchorReactiveTableSchemas(
  requirements: readonly GuardianReferenceKind[],
): Readonly<Record<string, Readonly<TableSchema>>> {
  if (requirements.includes('membership')) return MEMBERSHIP_REACTIVE_ANCHOR_TABLES;
  if (requirements.includes('user')) return USER_REACTIVE_ANCHOR_TABLES;
  return EMPTY_REACTIVE_ANCHOR_TABLES;
}
