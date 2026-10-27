/** Isolated native file/WAL lifecycle and authority tests. No HTTP, real identities or external providers. */
import { expect, test } from 'bun:test';
import { mkdtemp, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveAuthBehaviorConfig } from '../auth/auth-config';
import { installAuthAuthorityRevision } from '../auth/auth-authority-revision';
import { applicationServiceDataScope, serviceDataScopeKey, trustedSystemServiceDataScope, type ServiceDataScope } from '../auth/service-data-scope';
import { AuthorityCommitCoordinator } from '../databases/authority-commit-coordinator';
import { DatabaseActorAuthorityContext } from '../databases/database-actor-authority-context';
import { createReactiveDB } from '../sync/reactive-db';
import { resolveMessagingConfig } from './config';
import { MessagingRuntime } from './runtime';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'zero-messaging-runtime-'));
  const systemPath = join(root, 'system.sqlite'), system = createReactiveDB({ mode: 'file', path: systemPath });
  installAuthAuthorityRevision(system);
  const coordinator = new AuthorityCommitCoordinator(), actorContext = new DatabaseActorAuthorityContext(system, systemPath);
  const config = resolveMessagingConfig({ rootDirectory: 'messaging', maxActiveDatabases: 2 }, root, resolveAuthBehaviorConfig());
  if (!config) throw new Error('Synthetic messaging configuration was not resolved.');
  const options = { config, system, installAllowed: true, authority: { coordinator, actorContext }, observability: { config: { enabled: false }, store: null, sink: { emit() {} } } };
  let runtime = await MessagingRuntime.open(options), open = true;
  const actor = (scope: ServiceDataScope) => ({ scopeId: serviceDataScopeKey(scope), id: 'user-alice', kind: 'user', staff: false });
  return { root, system, options, actor, get runtime() { return runtime; },
    async restart(installAllowed = true) { await runtime.close(); open = false; runtime = await MessagingRuntime.open({ ...options, installAllowed }); open = true; },
    async stop() { if (open) await runtime.close(); open = false; },
    async close() { if (open) await runtime.close(); await coordinator.close(); system.dispose(); },
  };
}
const group = (actor: unknown, requestId: string) => ({ actor, id: 'group-one', requestId, kind: 'group', title: 'Synthetic group', userIds: ['user-bob'], contactsOnly: false, maxParticipants: 100 });

test('managed ownership retains separate concurrent tenant files and accepted receipts across restart without granting another scope', async () => {
  const f = await fixture(), first = trustedSystemServiceDataScope({ scopeKind: 'tenant', tenantId: 'org-one' }), second = trustedSystemServiceDataScope({ scopeKind: 'tenant', tenantId: 'org-two' });
  const guard = () => {};
  try {
    await Promise.all([first, second].map(scope => f.runtime.write(scope, 'messaging.conversation.create', group(f.actor(scope), 'create-one'), 'create-one', guard)));
    await Promise.all([first, second].flatMap(scope => Array.from({ length: 8 }, (_, n) => f.runtime.write(scope, 'messaging.message.send', {
      actor: f.actor(scope), conversationId: 'group-one', id: 'message-' + n, requestId: 'send-' + n, text: serviceDataScopeKey(scope) + ' synthetic ' + n, maxMessageLength: 20000,
    }, 'send-' + n, guard))));
    expect((f.system.prepare('SELECT count(*) AS count FROM _messaging_owners WHERE established=1').get() as { count: number }).count).toBe(2);
    for (const scope of [first, second]) {
      const page = await f.runtime.read<{ items: { text: string }[] }>(scope, 'messaging.messages', { actor: f.actor(scope), conversationId: 'group-one' }, guard);
      expect(page.items).toHaveLength(8); expect(page.items.every(message => message.text.startsWith(serviceDataScopeKey(scope)))).toBe(true);
    }
    await f.restart(false);
    expect(await f.runtime.read(first, 'messaging.receipt', { actor: f.actor(first), requestId: 'send-1' }, guard)).toMatchObject({ requestId: 'send-1', resourceId: 'message-1' });
    await expect(f.runtime.read(applicationServiceDataScope(), 'messaging.conversation', { actor: f.actor(applicationServiceDataScope()), id: 'group-one' }, guard)).rejects.toMatchObject({ code: 'MESSAGING_NOT_FOUND' });
  } finally { await f.close(); }
}, 30000);

test('missing retained files and a changed private root fail closed instead of creating empty conversations', async () => {
  const f = await fixture(), scope = applicationServiceDataScope(); let moved = false;
  try {
    await f.runtime.write(scope, 'messaging.conversation.create', group(f.actor(scope), 'create-one'), 'create-one', () => {});
    await f.stop();
    await expect(MessagingRuntime.open({ ...f.options, config: { ...f.options.config, rootDirectory: join(f.root, 'different-root') } })).rejects.toMatchObject({ code: 'MESSAGING_NOT_READY' });
    await rename(f.options.config.rootDirectory, join(f.root, 'retained-messaging')); moved = true;
    await expect(MessagingRuntime.open(f.options)).rejects.toMatchObject({ code: 'MESSAGING_NOT_READY' });
    await rename(join(f.root, 'retained-messaging'), f.options.config.rootDirectory); moved = false;
    await f.restart(false);
    expect(await f.runtime.read(scope, 'messaging.conversation', { actor: f.actor(scope), id: 'group-one' }, () => {})).toMatchObject({ id: 'group-one', revision: 1 });
  } finally { if (moved) await rename(join(f.root, 'retained-messaging'), f.options.config.rootDirectory); await f.close(); }
}, 30000);

test('async authority checks and revoked calls cannot provision new owners; closed runtimes do not admit work', async () => {
  const f = await fixture(), scope = applicationServiceDataScope();
  try {
    await expect(f.runtime.write(scope, 'messaging.conversation.create', group(f.actor(scope), 'create-one'), 'create-one', async () => {})).rejects.toMatchObject({ code: 'MESSAGING_CONFIG_INVALID' });
    await expect(f.runtime.read(scope, 'messaging.conversations', { actor: f.actor(scope) }, () => { throw new Error('Synthetic authority revoked'); })).rejects.toThrow('Synthetic authority revoked');
    expect((f.system.prepare('SELECT count(*) AS count FROM _messaging_owners').get() as { count: number }).count).toBe(0);
    await f.stop();
    await expect(f.runtime.read(scope, 'messaging.conversations', { actor: f.actor(scope) }, () => {})).rejects.toMatchObject({ code: 'MESSAGING_NOT_READY' });
  } finally { await f.close(); }
}, 30000);

test('payload-free commit subscriptions are scope-local and unsubscribe before shutdown', async () => {
  const f = await fixture(), first = applicationServiceDataScope(), second = trustedSystemServiceDataScope({ scopeKind: 'tenant', tenantId: 'org-two' });
  let notices = 0; const remove = f.runtime.subscribe(first, () => { notices++; });
  try {
    await f.runtime.write(second, 'messaging.conversation.create', group(f.actor(second), 'create-other'), 'create-other', () => {});
    expect(notices).toBe(0);
    await f.runtime.write(first, 'messaging.conversation.create', group(f.actor(first), 'create-one'), 'create-one', () => {});
    expect(notices).toBeGreaterThan(0); remove(); const prior = notices;
    await f.stop(); expect(notices).toBe(prior);
  } finally { remove(); await f.close(); }
}, 30000);
