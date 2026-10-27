/** Same-process producer qualification exposes real synthetic failures before the actor's mandatory privacy boundary. */
import { expect, test } from 'bun:test';
import { createPlatformSQLiteService } from '../persistence';
import { DatabaseRuntime } from '../databases/database-runtime';
import { DatabaseWriterOperationEngine } from '../databases/database-writer-engine';
import { LoggingActorSource, normalizeLoggingActorSourceBinding } from '../logging/logging-actor-source';
import { loggingContext } from '../logging/test-support/logging-fixture';
import { messagingRealm } from './realm';
test('exact message transport replay survives acknowledged transactional audit evidence without repeating a message or evidence', () => {
  const runtime = DatabaseRuntime.open({ id: 'messaging-test', role: 'named', sqlite: createPlatformSQLiteService({ mode: 'ephemeral' }), ownsSQLite: true, migrations: messagingRealm.migrations, tables: messagingRealm.tables, migrate: true, migrationLog() {} });
  const engine = new DatabaseWriterOperationEngine({ runtime, realm: messagingRealm });
  const source = new LoggingActorSource(runtime.db, normalizeLoggingActorSourceBinding({ records: true, policyVersion: 'fixture-policy-1', scope: { kind: 'application', tenantId: null } }));
  const actor = { scopeId: 'application', id: 'fixture-user', kind: 'user', staff: false };
  const run = (name: string, input: object, idempotencyKey: string) => source.run(loggingContext(null), () => engine.execute({ type: 'command', name, input, idempotencyKey }));
  try {
    run('messaging.conversation.create', { actor, id: 'conversation-one', requestId: 'create-one', kind: 'direct', title: '', userIds: ['second-user'], contactsOnly: false, maxParticipants: 100 }, 'create-one');
    const message = { actor, id: 'message-one', requestId: 'send-one', conversationId: 'conversation-one', text: 'Private synthetic text', maxMessageLength: 20000, assistantEnabled: false, notificationsEnabled: false };
    const accepted = run('messaging.message.send', message, 'send-one');
    const evidence = source.control({}); source.control({ acknowledge: evidence.rows.map(row => row.id) });
    const replay = run('messaging.message.send', message, 'send-one');
    expect(replay).toEqual({ ...accepted, replayed: true });
    expect(runtime.db.list('messaging_messages')).toHaveLength(1); expect(source.control({}).queued).toBe(0);
  } finally { source.close(); engine.close(); runtime.close(); }
});
