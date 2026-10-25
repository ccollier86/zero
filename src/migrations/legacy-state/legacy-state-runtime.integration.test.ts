/** No real app state: boot migrated synthetic databases using normal managed public services. */
import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createApp, defineEndpoint, defineTable, field } from '../../frontend/server';
import { planLegacyStateMigration, stageLegacyStateMigration, verifyStagedLegacyStateMigration } from '../index';
import { fixture, syntheticPassword, syntheticAction, syntheticResume, syntheticRefresh, syntheticMutation, digest } from './test-support';

for (const mode of ['file', 'hot'] as const) {
  test(`staged legacy ${mode}: normal login/refresh, scoped Storage, tokens and unchanged pending work`, async () => {
    const f = await fixture();
    let app: Awaited<ReturnType<typeof createApp>> | undefined;
    try {
      const plan = await planLegacyStateMigration(f.input), outputDirectory = join(f.root, 'generation');
      const staged = await stageLegacyStateMigration({ ...f.input, expectedPlanFingerprint: plan.fingerprint, outputDirectory, resetReactiveHistory: true });
      await verifyStagedLegacyStateMigration({ ...f.input, expectedPlanFingerprint: plan.fingerprint, outputDirectory });
      await mkdir(join(f.root, 'app'));
      const patients = defineTable('patients', { owner_id: field.guardianUser() }, { pk: 'patient_id' });
      const config: Parameters<typeof createApp>[0] = {
        projectRoot: f.root, db: { mode, path: staged.applicationDatabase.path },
        systemDb: { mode: 'file', path: staged.systemDatabase.path, synchronous: 'FULL' },
        tables: { patients: patients.serverTable, notes: { id: 'text primary key', patient_id: 'text references patients(patient_id)', text: 'text' } },
        auth: { tenancy: 'single', bootstrap: 'public', registration: { mode: 'admin-only' },
          userProperties: { practice_role: { type: 'enum', values: ['clinician'], editableBy: 'admin', useInPolicies: true } },
          accountEmails: { passwordReset: false } },
        // Pending work is preserved, not implicitly reauthorized during copying.
        workflows: false,
        serverExtensions: [
          defineEndpoint({ method: 'GET', path: '/proof', auth: 'required', handler({ zero, user }) {
            return { userId: user.userId,
              action: zero.tokens!.inspectActionToken(syntheticAction, { purposes: ['clinical:review'] }),
              resume: zero.tokens!.verifyResumeToken(syntheticResume, { flow: 'clinical:intake' }),
              drive: zero.storage!.drives.get('legacy-drive'),
              object: zero.storage!.objects.get('legacy-drive', '/letter.pdf'),
              grants: zero.storage!.permissions.list('legacy-drive') };
          } }),
          defineEndpoint({ method: 'POST', path: '/proof/consume', auth: 'required', handler({ zero }) {
            return zero.tokens!.consumeActionToken(syntheticAction, { purposes: ['clinical:review'] });
          } }),
          defineEndpoint({ method: 'GET', path: '/proof/identity', auth: 'required', handler({ user }) { return { userId: user.userId }; } }),
          defineEndpoint({ method: 'GET', path: '/proof/storage', auth: 'required', handler({ zero }) {
            return { drive: zero.storage!.drives.get('legacy-drive'),
              read: zero.storage!.permissions.checkAccess('legacy-drive', null, 'read'),
              write: zero.storage!.permissions.checkAccess('legacy-drive', null, 'write') };
          } }),
        ],
        appDir: join(f.root, 'app'), outDir: join(f.root, 'out'), generatedDir: join(f.root, 'generated'), storageDir: join(f.root, 'storage'),
        serverEndpointsDir: false, serverRoutesDir: false, serverPluginsDir: false, serverMiddlewareDir: false, serverResourcesDir: false,
        email: false, stateSync: false, ai: false, vector: false, pdf: false, kv: false, observability: { console: false, endpoint: false },
      };
      app = await createApp(config);
      app.listen({ hostname: '127.0.0.1', port: 0 });
      const origin = `http://127.0.0.1:${app.server!.port}`;
      async function request(method: string, path: string, body?: object, token?: string) {
        const response = await fetch(origin + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          ...(body ? { body: JSON.stringify(body) } : {}) });
        const text = await response.text();
        let data: any;
        try { data = JSON.parse(text); } catch {
          if (response.ok) throw new Error(`Synthetic request ${method} ${path} returned ${response.status}: ${text}`);
          data = { message: text };
        }
        return { status: response.status, data };
      }
      expect((await request('GET', '/proof')).status).toBe(401);
      expect((await request('POST', '/auth/login', { username: 'legacy-owner', password: 'wrong-password' })).status).toBe(401);
      const login = await request('POST', '/auth/login', { username: 'legacy-owner', password: syntheticPassword });
      expect(login.status, JSON.stringify(login.data)).toBe(200);
      expect(login.data.user).toMatchObject({ userId: 'legacy-user', role: 'admin', properties: { practice_role: 'clinician' } });
      const token = login.data.accessToken;
      // Exercise the actual managed public Sync handshake, not a private SQL replay.
      // Executing the old UPDATE again would replace the newer retained text.
      const socket = await syncConnection(origin.replace('http:', 'ws:') + '/sync');
      try {
        socket.ws.send(JSON.stringify({ type: 'sync.auth', token }));
        expect(await socket.next(message => message.type === 'sync.auth.ready')).toMatchObject({ authenticated: true });
        for (let attempt = 2; attempt <= 3; attempt++) {
          socket.ws.send(JSON.stringify({ ...syntheticMutation, epoch: 'before-offline-conversion', attempt }));
          const ack = await socket.next(message => message.type === 'sync.ack' && message.ref === syntheticMutation.ref);
          expect(ack).toMatchObject({ ok: true, change: { table: 'notes', rowId: 'legacy-note', row: { text: 'Synthetic retained text' } } });
        }
        socket.ws.send(JSON.stringify({ ...syntheticMutation, attempt: 2, row: { text: 'Conflicting new request' } }));
        expect(await socket.next(message => message.type === 'sync.ack')).toMatchObject({ ok: false, error: 'Mutation reference conflict' });
        socket.ws.send(JSON.stringify({ type: 'sync.subscribe', tables: ['notes'], snapshot: ['notes'], lastSeq: 0 }));
        expect(await socket.next(message => message.type === 'sync.snapshot')).toMatchObject({ tables: { notes: { 'legacy-note': expect.objectContaining({ text: 'Synthetic retained text' }) } } });
      } finally { socket.ws.close(); }
      const proof = await request('GET', '/proof', undefined, token);
      expect(proof.status, JSON.stringify(proof.data)).toBe(200);
      expect(proof.data).toMatchObject({ userId: 'legacy-user',
        action: { tokenId: 'action-id' }, resume: { tokenId: 'resume-id' }, drive: { drive_id: 'legacy-drive', owner_id: 'legacy-user' } });
      expect(proof.data.object).toMatchObject({ id: 'legacy-object' });
      expect(proof.data.grants).toContainEqual(expect.objectContaining({ permission_id: 'legacy-grant', grant_value: 'legacy-staff' }));
      const staff = await request('POST', '/auth/login', { username: 'legacy-staff', password: syntheticPassword });
      expect(staff.status).toBe(200); expect(staff.data.user.userId).toBe('legacy-staff');
      expect((await request('GET', '/proof/storage', undefined, staff.data.accessToken)).data).toMatchObject({ drive: { drive_id: 'legacy-drive' }, read: true, write: false });
      const outsider = await request('POST', '/auth/login', { username: 'legacy-outsider', password: syntheticPassword });
      expect(outsider.status).toBe(200);
      expect((await request('GET', '/proof/storage', undefined, outsider.data.accessToken)).data).toEqual({ drive: null, read: false, write: false });
      expect((await request('POST', '/proof/consume', {}, token)).data).toMatchObject({ tokenId: 'action-id' });
      expect((await request('POST', '/proof/consume', {}, token)).status).not.toBe(200);
      const renewedLegacy = await request('POST', '/auth/refresh', { refreshToken: syntheticRefresh });
      expect(renewedLegacy.status, JSON.stringify(renewedLegacy.data)).toBe(200);
      expect((await request('GET', '/proof/identity', undefined, renewedLegacy.data.accessToken)).data.userId).toBe('legacy-user');
      expect((await request('POST', '/auth/refresh', { refreshToken: syntheticRefresh })).status).toBe(401);
      // Replay detection may revoke other live credentials for the account.
      // Do not mistake that protection for an import failure.
      const fresh = await request('POST', '/auth/login', { username: 'legacy-owner', password: syntheticPassword });
      expect(fresh.status).toBe(200);
      const renewed = await request('POST', '/auth/refresh', { refreshToken: fresh.data.refreshToken });
      expect(renewed.status).toBe(200);
      expect((await request('POST', '/auth/logout', { refreshToken: renewed.data.refreshToken }, renewed.data.accessToken)).status).toBe(200);
      expect((await request('POST', '/proof/consume', {}, renewed.data.accessToken)).status).toBe(401);
      await app.stop(true); app = undefined;
      // Bindings are durable across a normal managed restart, not just retained
      // in the receipt-store instance used by the first process.
      app = await createApp(config);
      app.listen({ hostname: '127.0.0.1', port: 0 });
      const restartedOrigin = `http://127.0.0.1:${app.server!.port}`;
      const restartedLogin = await fetch(restartedOrigin + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'legacy-owner', password: syntheticPassword }) });
      expect(restartedLogin.status).toBe(200);
      const restartedToken = (await restartedLogin.json() as any).accessToken;
      const resumed = await syncConnection(restartedOrigin.replace('http:', 'ws:') + '/sync');
      try {
        resumed.ws.send(JSON.stringify({ type: 'sync.auth', token: restartedToken }));
        await resumed.next(message => message.type === 'sync.auth.ready');
        resumed.ws.send(JSON.stringify({ ...syntheticMutation, attempt: 4, epoch: 'before-offline-conversion' }));
        expect(await resumed.next(message => message.type === 'sync.ack')).toMatchObject({ ok: true, change: { row: { text: 'Synthetic retained text' } } });
      } finally { resumed.ws.close(); }
      await app.stop(true); app = undefined;
      const pending = () => {
        const db = new Database(staged.systemDatabase.path, { readonly: true });
        try { return ['workflow_instances', 'workflow_steps', 'workflow_events'].map(table => db.query(`SELECT * FROM ${table}`).all()); }
        finally { db.close(); }
      };
      const beforeRecovery = pending();
      let unexpectedCalls = 0;
      await expect(createApp({ ...config, workflows: { register(registry) {
        registry.registerHandler('review', async () => { unexpectedCalls++; return null; });
        registry.create({ name: 'clinical-followup', steps: [{ name: 'review', handler: 'review', waitFor: 'approved' }] });
      } } })).rejects.toMatchObject({ code: 'WORKFLOW_LEGACY_MIGRATION_REQUIRED' });
      expect(unexpectedCalls).toBe(0);
      expect(pending()).toEqual(beforeRecovery);
      expect(digest(new Uint8Array(await Bun.file(f.sourcePath).arrayBuffer()))).toBe(f.input.sourceSha256);
    } finally { try { await app?.stop(true); } finally { f.dispose(); } }
  }, 60_000);
}

async function syncConnection(url: string) {
  const ws = new WebSocket(url), messages: any[] = [];
  const waiters = new Set<() => void>();
  ws.addEventListener('message', event => { messages.push(JSON.parse(String(event.data))); for (const waiter of waiters) waiter(); });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Synthetic Sync connect timeout')), 5000);
    ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Synthetic Sync connect failed')); }, { once: true });
  });
  return { ws, next(predicate: (message: any) => boolean) {
    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => { waiters.delete(check); reject(new Error('Synthetic Sync message timeout')); }, 5000);
      function check() {
        const index = messages.findIndex(predicate);
        if (index < 0) return;
        clearTimeout(timer); waiters.delete(check); resolve(messages.splice(index, 1)[0]);
      }
      waiters.add(check); check();
    });
  } };
}
