/** Process-local identity for result-shaping server source dependencies. */

import type { Row } from '../../sync/types';
import type { DataTableServerSource } from './data-table-server-types';

const identities = new WeakMap<object, number>();
let nextIdentity = 1;

export function dataTableServerSourceIdentity<T extends Row>(
  source: DataTableServerSource<T> | null,
  client?: object | null,
): string {
  if (!source) return 'none';
  return JSON.stringify([
    source.adapter ? objectIdentity(source.adapter) : 'builtin',
    source.getRowId ? objectIdentity(source.getRowId) : 'schema-primary-key',
    client ? objectIdentity(client) : 'standalone',
  ]);
}

function objectIdentity(value: object): number {
  const current = identities.get(value);
  if (current !== undefined) return current;
  const identity = nextIdentity;
  nextIdentity += 1;
  identities.set(value, identity);
  return identity;
}
