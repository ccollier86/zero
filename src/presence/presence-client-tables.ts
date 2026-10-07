/** Pure shared presence table catalog; safe to import in browser and native SDKs. */
import type { ClientTableDef } from '../sync/types';

export const PRESENCE_TABLE = 'guardian_presence';
export const PRESENCE_OWNER_TABLE = 'guardian_presence_owner';
export const PRESENCE_CLIENT_TABLES: Readonly<Record<string, ClientTableDef>> = Object.freeze({
  [PRESENCE_TABLE]: Object.freeze({ _pk: 'id', _sync: 'full', id: 'string', scope_kind: 'string', scope_id: 'string',
    user_id: 'string', status_key: 'string', connected: 'number', revision: 'number', owner_epoch: 'number', updated_at: 'number' }),
  [PRESENCE_OWNER_TABLE]: Object.freeze({ _pk: 'owner_key', _sync: 'full', owner_key: 'string', owner_epoch: 'number', fresh_until: 'number', retired: 'number' }),
});
