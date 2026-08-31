/**
 * resources.ts
 *
 * Registers LaunchBoard app tables as owner-scoped Zero resources. This file
 * owns authorization policy declarations only; UI filtering and table schema
 * stay in their own modules.
 */

import { defineResource, ownerPolicy } from '@zero/framework/server';

const launchBoardOwnerPolicy = ownerPolicy({ userField: 'owner_id' });

/**
 * Owner-scoped resources used by generated CRUD, /api/data, and WebSocket sync.
 *
 * The policy stamps `owner_id` on creates and constrains snapshots/live changes
 * to the authenticated user.
 */
export const launchBoardResources = [
  defineResource({
    table: 'launch_categories',
    policy: launchBoardOwnerPolicy,
  }),
  defineResource({
    table: 'launch_boards',
    policy: launchBoardOwnerPolicy,
  }),
  defineResource({
    table: 'launch_columns',
    policy: launchBoardOwnerPolicy,
  }),
  defineResource({
    table: 'launch_cards',
    policy: launchBoardOwnerPolicy,
  }),
] as const;
