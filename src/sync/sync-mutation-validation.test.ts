import { describe, expect, test } from 'bun:test';
import type { ServerWebSocket } from 'bun';
import { defineTable, field } from '../schema';
import { routeMessage } from './message-handler';
import { createReactiveDB } from './reactive-db';
import type {
  ServerMessage,
  SyncAckMessage,
  SyncMutateMessage,
  SyncResourcePolicyAdapter,
  SyncSocketData,
  SyncTableMutationValidator,
} from './types';

function socket(tableNames: string[]) {
  const messages: ServerMessage[] = [];
  const closes: Array<[number, string]> = [];
  const data: SyncSocketData = {
    allowedTables: new Set(tableNames),
    subscribedTopics: new Set(),
    lastSeq: 0,
    syncSubscribedTables: new Set(),
    syncBackpressured: false,
    authContext: { userId: 'user-1', email: 'user@example.com', role: 'user' },
    authResolved: true,
    authorizationFingerprint: 'policy',
    authorizationScope: 'scope',
    connectionId: 'connection-1',
    query: {},
    stateSubscribed: false,
    ephemeralTopics: new Set(),
    resourceRowFilters: new Map(),
    rowFilteredSubscribedTables: new Set(),
  };
  const value = {
    data,
    send(payload: string) {
      messages.push(JSON.parse(payload));
      return payload.length;
    },
    close(code: number, reason: string) { closes.push([code, reason]); },
    subscribe() {},
    unsubscribe() {},
  } as unknown as ServerWebSocket<SyncSocketData>;
  return { value, messages, closes };
}

async function mutate(input: {
  db: ReturnType<typeof createReactiveDB>;
  message: SyncMutateMessage;
  validators?: Record<string, SyncTableMutationValidator>;
  resourcePolicy?: SyncResourcePolicyAdapter;
  revalidateMutationAuthority?: () => Promise<boolean>;
  validateMutationAuthorityAtCommit?: () => boolean;
}): Promise<SyncAckMessage> {
  const ws = socket(input.db.getTableNames());
  await routeMessage(
    ws.value,
    input.message as unknown as Record<string, unknown>,
    input.db,
    { publish() {} },
    null,
    null,
    undefined,
    undefined,
    input.resourcePolicy,
    undefined,
    undefined,
    input.validators,
    undefined,
    'single',
    input.revalidateMutationAuthority,
    input.validateMutationAuthorityAtCommit,
  );
  return ws.messages.at(-1) as SyncAckMessage;
}

describe('Sync logical mutation validation', () => {
  test('never sends a negative acknowledgement after a projector fails post-commit', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    db.defineTable('documents', {
      id: 'text primary key',
      title: 'text not null',
    });
    const ws = socket(['documents']);
    ws.value.data.resourceRowProjectors = new Map([['documents', {
      project() {
        throw new Error('projector failed after commit');
      },
    }]]);

    await routeMessage(
      ws.value,
      {
        type: 'sync.mutate', ref: 'projector-failed', table: 'documents', op: 'INSERT',
        row: { id: 'document-1', title: 'Committed' },
      },
      db,
      { publish() {} },
    );

    expect(db.get('documents', 'document-1')).toMatchObject({ title: 'Committed' });
    expect(ws.messages).toEqual([]);
    expect(ws.closes).toEqual([[
      1011,
      'Sync acknowledgement projection failed',
    ]]);
    db.dispose();
  });

  test('does not acknowledge a committed row after its projector revokes read authority', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    db.defineTable('documents', {
      id: 'text primary key',
      title: 'text not null',
    });
    const ws = socket(['documents']);
    let authorityCurrent = true;
    let projections = 0;
    ws.value.data.resourceRowProjectors = new Map([['documents', {
      project(row) {
        projections += 1;
        authorityCurrent = false;
        return row;
      },
    }]]);

    await routeMessage(
      ws.value,
      {
        type: 'sync.mutate', ref: 'revoked-before-ack', table: 'documents', op: 'INSERT',
        row: { id: 'document-1', title: 'Committed' },
      },
      db,
      { publish() {} },
      null,
      null,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'single',
      undefined,
      undefined,
      undefined,
      undefined,
      () => {
        if (!authorityCurrent) throw databaseAuthorityChanged();
      },
    );

    expect(projections).toBe(1);
    expect(db.get('documents', 'document-1')).toMatchObject({ title: 'Committed' });
    expect(ws.messages).toEqual([]);
    db.dispose();
  });

  test('rejects a missing required field before starting a write', async () => {
    const todos = defineTable('todos', {
      title: field.text({ required: true }),
      done: field.boolean(),
    });
    const db = createReactiveDB({ mode: 'memory' });
    db.defineTable('todos', todos.serverTable);
    const before = db.currentSeq;

    const ack = await mutate({
      db,
      validators: { todos: todos.mutationValidator },
      message: {
        type: 'sync.mutate', ref: 'missing-title', table: 'todos', op: 'INSERT',
        row: { id: 'todo-1' },
      },
    });

    expect(ack.ok).toBe(false);
    expect(ack.error).toContain('Invalid row for table "todos"');
    expect(ack.error).toContain('title');
    expect(db.get('todos', 'todo-1')).toBeNull();
    expect(db.currentSeq).toBe(before);
    db.dispose();
  });

  test('does not expose thrown validator or codec details on the wire', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    db.defineTable('documents', {
      id: 'text primary key',
      title: 'text not null',
    });
    const validator: SyncTableMutationValidator = {
      primaryKey: 'id',
      fieldNames: ['title'],
      decodeRow() {
        throw new Error('private /workspace/customer.sqlite PHI-SECRET');
      },
      validateRow() {
        throw new Error('not reached');
      },
      encodeRow() {
        throw new Error('not reached');
      },
    };

    const ack = await mutate({
      db,
      validators: { documents: validator },
      message: {
        type: 'sync.mutate',
        ref: 'private-validator-error',
        table: 'documents',
        op: 'INSERT',
        row: { id: 'document-1', title: 'Private' },
      },
    });

    expect(ack).toMatchObject({
      ok: false,
      error: 'Invalid row for table "documents": logical row validation failed',
    });
    expect(JSON.stringify(ack)).not.toContain('PHI-SECRET');
    expect(db.get('documents', 'document-1')).toBeNull();
    db.dispose();
  });

  test('does not expose raw SQLite mutation failures on the wire', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    db.defineTable('accounts', {
      id: 'text primary key',
      email: 'text not null unique',
    });
    db.insert('accounts', { id: 'account-1', email: 'private@example.com' });

    const ack = await mutate({
      db,
      message: {
        type: 'sync.mutate',
        ref: 'private-sqlite-error',
        table: 'accounts',
        op: 'INSERT',
        row: { id: 'account-2', email: 'private@example.com' },
      },
    });

    expect(ack).toMatchObject({ ok: false, error: 'Mutation failed' });
    expect(JSON.stringify(ack)).not.toContain('UNIQUE');
    expect(JSON.stringify(ack)).not.toContain('private@example.com');
    expect(db.get('accounts', 'account-2')).toBeNull();
    db.dispose();
  });

  test('decodes logical booleans/codecs and validates UPDATE against the merged row', async () => {
    const preferences = defineTable('preferences', {
      name: field.text({ required: true }),
      enabled: field.boolean({ required: true }),
      tags: field.tags(),
      settings: field.json(),
    });
    const db = createReactiveDB({ mode: 'memory' });
    db.defineTable('preferences', preferences.serverTable);
    const validators = { preferences: preferences.mutationValidator };

    const inserted = await mutate({
      db,
      validators,
      message: {
        type: 'sync.mutate', ref: 'insert-codecs', table: 'preferences', op: 'INSERT',
        row: {
          id: 'preference-1', name: 'Primary', enabled: true,
          tags: ['alpha', 'beta'], settings: { density: 'compact' },
        },
      },
    });
    expect(inserted.ok).toBe(true);
    expect(db.get('preferences', 'preference-1')).toEqual({
      id: 'preference-1',
      name: 'Primary',
      enabled: 1,
      tags: '["alpha","beta"]',
      settings: '{"density":"compact"}',
    });

    const updated = await mutate({
      db,
      validators,
      message: {
        type: 'sync.mutate', ref: 'partial-update', table: 'preferences', op: 'UPDATE',
        rowId: 'preference-1', row: { enabled: false },
      },
    });
    expect(updated.ok).toBe(true);
    expect(db.get('preferences', 'preference-1')).toMatchObject({
      name: 'Primary', enabled: 0, tags: '["alpha","beta"]',
    });

    const beforeInvalid = db.currentSeq;
    const invalid = await mutate({
      db,
      validators,
      message: {
        type: 'sync.mutate', ref: 'invalid-boolean', table: 'preferences', op: 'UPDATE',
        rowId: 'preference-1', row: { enabled: 2 },
      },
    });
    expect(invalid.ok).toBe(false);
    expect(invalid.error).toContain('enabled');
    expect(invalid.error?.toLowerCase()).toContain('boolean');
    expect(db.get('preferences', 'preference-1')?.enabled).toBe(0);
    expect(db.currentSeq).toBe(beforeInvalid);
    db.dispose();
  });

  test('accepts generated default and custom primary-key fields on INSERT', async () => {
    const notes = defineTable('notes', {
      body: field.text({ required: true }),
    });
    const accounts = defineTable('accounts', {
      name: field.text({ required: true }),
    }, { pk: 'account_id' });
    const memberships = defineTable('memberships', {
      team_id: field.text({ required: true }),
      user_id: field.text({ required: true }),
    }, {
      pk: 'membership_id',
      identity: ['team_id', 'user_id'],
    });
    const db = createReactiveDB({ mode: 'memory' });
    db.defineTable('notes', notes.serverTable);
    db.defineTable('accounts', accounts.serverTable);
    db.defineTable('memberships', memberships.serverTable);

    const noteAck = await mutate({
      db,
      validators: { notes: notes.mutationValidator },
      message: {
        type: 'sync.mutate', ref: 'default-pk', table: 'notes', op: 'INSERT',
        row: { id: 'note-generated-by-client', body: 'Remember' },
      },
    });
    const accountAck = await mutate({
      db,
      validators: { accounts: accounts.mutationValidator },
      message: {
        type: 'sync.mutate', ref: 'custom-pk', table: 'accounts', op: 'INSERT',
        row: { account_id: 'account-generated-by-client', name: 'Acme' },
      },
    });

    expect(noteAck.ok).toBe(true);
    expect(accountAck.ok).toBe(true);
    expect(db.get('notes', 'note-generated-by-client')?.body).toBe('Remember');
    expect(db.get('accounts', 'account-generated-by-client')?.name).toBe('Acme');

    const beforeMissingKey = db.currentSeq;
    const missingKey = await mutate({
      db,
      validators: { accounts: accounts.mutationValidator },
      message: {
        type: 'sync.mutate', ref: 'missing-custom-pk', table: 'accounts', op: 'INSERT',
        row: { name: 'No client-generated key' },
      },
    });
    expect(missingKey.ok).toBe(false);
    expect(missingKey.error).toContain('missing primary key "account_id"');
    expect(db.currentSeq).toBe(beforeMissingKey);

    const identityAck = await mutate({
      db,
      validators: { memberships: memberships.mutationValidator },
      message: {
        type: 'sync.mutate', ref: 'derived-identity-pk', table: 'memberships', op: 'INSERT',
        row: { team_id: 'team-1', user_id: 'user-1' },
      },
    });
    expect(identityAck.ok).toBe(true);
    expect(db.query('memberships')).toEqual([{
      membership_id: expect.stringMatching(/^zi1:/),
      team_id: 'team-1',
      user_id: 'user-1',
    }]);
    db.dispose();
  });

  test('validates policy-stamped input rather than the unstamped client row', async () => {
    const documents = defineTable('documents', {
      title: field.text({ required: true }),
      owner_id: field.text({ required: true }),
    });
    const db = createReactiveDB({ mode: 'memory' });
    db.defineTable('documents', documents.serverTable);
    const resourcePolicy: SyncResourcePolicyAdapter = {
      async resolveTableAccess() {
        return { readableTables: new Set(['documents']), rowFilters: new Map() };
      },
      async authorizeMutation(context) {
        return {
          ok: true,
          row: { ...context.row, owner_id: context.authContext?.userId },
        };
      },
    };

    const ack = await mutate({
      db,
      validators: { documents: documents.mutationValidator },
      resourcePolicy,
      message: {
        type: 'sync.mutate', ref: 'stamped-owner', table: 'documents', op: 'INSERT',
        row: { id: 'document-1', title: 'Private' },
      },
    });

    expect(ack.ok).toBe(true);
    expect(db.get('documents', 'document-1')?.owner_id).toBe('user-1');
    db.dispose();
  });

  test('revalidates live authority after asynchronous resource policy work', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    db.defineTable('documents', {
      id: 'text primary key',
      title: 'text not null',
    });
    let revalidations = 0;
    const resourcePolicy: SyncResourcePolicyAdapter = {
      async resolveTableAccess() {
        return { readableTables: new Set(['documents']), rowFilters: new Map() };
      },
      async authorizeMutation() {
        await Promise.resolve();
        return { ok: true };
      },
    };

    const ack = await mutate({
      db,
      resourcePolicy,
      revalidateMutationAuthority: async () => {
        revalidations += 1;
        return false;
      },
      message: {
        type: 'sync.mutate', ref: 'revoked-during-policy',
        table: 'documents', op: 'INSERT',
        row: { id: 'document-revoked', title: 'Must not commit' },
      },
    });

    expect(revalidations).toBe(1);
    expect(ack).toMatchObject({
      ok: false,
      error: 'Authorization changed during mutation',
    });
    expect(db.get('documents', 'document-revoked')).toBeNull();
    db.dispose();
  });

  test('rejects authority revoked after async revalidation at the SQLite commit edge', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    db.defineTable('documents', {
      id: 'text primary key',
      title: 'text not null',
    });
    let commitChecks = 0;
    const resourcePolicy: SyncResourcePolicyAdapter = {
      async resolveTableAccess() {
        return { readableTables: new Set(['documents']), rowFilters: new Map() };
      },
      async authorizeMutation() {
        await Promise.resolve();
        return { ok: true };
      },
    };

    const ack = await mutate({
      db,
      resourcePolicy,
      revalidateMutationAuthority: async () => true,
      validateMutationAuthorityAtCommit: () => {
        commitChecks += 1;
        return false;
      },
      message: {
        type: 'sync.mutate', ref: 'revoked-at-commit',
        table: 'documents', op: 'INSERT',
        row: { id: 'document-revoked-at-commit', title: 'Must not commit' },
      },
    });

    expect(commitChecks).toBe(1);
    expect(ack).toMatchObject({
      ok: false,
      error: 'Authorization changed during mutation',
    });
    expect(db.get('documents', 'document-revoked-at-commit')).toBeNull();
    db.dispose();
  });

  test('conditionally writes the exact row snapshot evaluated by resource policy', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    db.defineTable('documents', {
      id: 'text primary key',
      title: 'text not null',
    });
    db.insert('documents', { id: 'document-race', title: 'Original' });
    const resourcePolicy: SyncResourcePolicyAdapter = {
      async resolveTableAccess() {
        return { readableTables: new Set(['documents']), rowFilters: new Map() };
      },
      async authorizeMutation(context) {
        const expectedRow = await context.loadRow(context.table, context.rowId!);
        await Promise.resolve();
        db.prepare('UPDATE documents SET title = ? WHERE id = ?')
          .run('Changed while policy yielded', context.rowId!);
        return { ok: true, expectedRow: expectedRow! };
      },
    };

    const ack = await mutate({
      db,
      resourcePolicy,
      message: {
        type: 'sync.mutate', ref: 'row-policy-race',
        table: 'documents', op: 'UPDATE', rowId: 'document-race',
        row: { title: 'Must not overwrite newer state' },
      },
    });

    expect(ack.ok).toBe(false);
    expect(ack.error).toContain('row changed since authorization');
    expect(db.get('documents', 'document-race')?.title)
      .toBe('Changed while policy yielded');
    db.dispose();
  });

  test('registered resource creates cannot replace an existing primary key', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    db.defineTable('documents', {
      id: 'text primary key',
      title: 'text not null',
    });
    db.insert('documents', { id: 'document-existing', title: 'Original' });
    const resourcePolicy: SyncResourcePolicyAdapter = {
      async resolveTableAccess() {
        return { readableTables: new Set(['documents']), rowFilters: new Map() };
      },
      async authorizeMutation() {
        return { ok: true, createOnly: true };
      },
    };

    const ack = await mutate({
      db,
      resourcePolicy,
      message: {
        type: 'sync.mutate', ref: 'strict-resource-create',
        table: 'documents', op: 'INSERT',
        row: { id: 'document-existing', title: 'Must not replace' },
      },
    });

    expect(ack.ok).toBe(false);
    expect(ack.error).toContain('primary key already exists');
    expect(db.get('documents', 'document-existing')?.title).toBe('Original');
    db.dispose();
  });

  test('rejects unknown columns and primary-key changes without modifying the row', async () => {
    const todos = defineTable('todos', {
      title: field.text({ required: true }),
      done: field.boolean(),
    });
    const db = createReactiveDB({ mode: 'memory' });
    db.defineTable('todos', todos.serverTable);
    db.insert('todos', { id: 'todo-1', title: 'Original', done: 0 });
    const validators = { todos: todos.mutationValidator };

    const beforeUnknown = db.currentSeq;
    const unknown = await mutate({
      db,
      validators,
      message: {
        type: 'sync.mutate', ref: 'unknown-column', table: 'todos', op: 'UPDATE',
        rowId: 'todo-1', row: { title: 'Changed', admin: true },
      },
    });
    expect(unknown.ok).toBe(false);
    expect(unknown.error).toContain('unknown field: "admin"');
    expect(db.currentSeq).toBe(beforeUnknown);
    expect(db.get('todos', 'todo-1')?.title).toBe('Original');

    const changedPrimaryKey = await mutate({
      db,
      validators,
      message: {
        type: 'sync.mutate', ref: 'changed-pk', table: 'todos', op: 'UPDATE',
        rowId: 'todo-1', row: { id: 'todo-2', title: 'Changed' },
      },
    });
    expect(changedPrimaryKey.ok).toBe(false);
    expect(changedPrimaryKey.error).toContain('cannot change primary key "id"');
    expect(db.currentSeq).toBe(beforeUnknown);
    expect(db.get('todos', 'todo-1')?.title).toBe('Original');
    expect(db.get('todos', 'todo-2')).toBeNull();

    const samePrimaryKey = await mutate({
      db,
      validators,
      message: {
        type: 'sync.mutate', ref: 'same-pk', table: 'todos', op: 'UPDATE',
        rowId: 'todo-1', row: { id: 'todo-1', title: 'Allowed' },
      },
    });
    expect(samePrimaryKey.ok).toBe(true);
    expect(db.get('todos', 'todo-1')?.title).toBe('Allowed');
    db.dispose();
  });

  test('keeps raw SQL tables permissive unless an explicit validator is supplied', async () => {
    const logical = defineTable('raw_items', {
      label: field.text({ required: true }),
    });
    const db = createReactiveDB({ mode: 'memory' });
    db.defineTable('unvalidated', {
      id: 'text primary key',
      label: 'text not null',
    });
    db.defineTable('validated', {
      id: 'text primary key',
      label: 'text not null',
    });

    const compatible = await mutate({
      db,
      message: {
        type: 'sync.mutate', ref: 'raw-compatible', table: 'unvalidated', op: 'INSERT',
        row: { id: 'raw-1', label: 'Kept', ignored_legacy_value: 'legacy' },
      },
    });
    expect(compatible.ok).toBe(true);
    expect(db.get('unvalidated', 'raw-1')).toEqual({ id: 'raw-1', label: 'Kept' });

    const beforeRejected = db.currentSeq;
    const rejected = await mutate({
      db,
      validators: { validated: logical.mutationValidator },
      message: {
        type: 'sync.mutate', ref: 'raw-explicit', table: 'validated', op: 'INSERT',
        row: { id: 'raw-2', label: 'Rejected', extra: true },
      },
    });
    expect(rejected.ok).toBe(false);
    expect(db.get('validated', 'raw-2')).toBeNull();
    expect(db.currentSeq).toBe(beforeRejected);
    db.dispose();
  });
});

function databaseAuthorityChanged(): Error & { code: string } {
  return Object.assign(new Error('read authority changed'), {
    code: 'DATABASE_AUTHORITY_CHANGED',
  });
}
