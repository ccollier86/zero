/** Live authority fences around real worker admission, queue waits and results; no real accounts/providers. */
import { expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { createRequestAuthorizationAccess } from '../auth/authorization-access';
import { resolveAuthBehaviorConfig } from '../auth/auth-config';
import { createAuthorizationKernel } from '../auth/authorization-kernel';
import { applicationServiceDataScope } from '../auth/service-data-scope';
import { AuthError } from '../auth/types';
import { WorkerService } from './service';
import { tasks } from './test-support/worker-entry';

function fixture() {
  let live = true;
  const access = createRequestAuthorizationAccess({ kernel: createAuthorizationKernel(resolveAuthBehaviorConfig({})),
    authContext: { userId: 'worker-synthetic-admin', email: 'worker@example.test', role: 'admin' } });
  const check = () => { if (!live) throw new AuthError('Synthetic authority retired.', 'AUTH_STATE_CHANGED', 409); };
  const owner = new WorkerService({ tasks, launch: { kind: 'source', entrypoint: fileURLToPath(new URL('./test-support/worker-entry.ts', import.meta.url)) }, processes: 1 });
  const facade = owner.forAuthority({ access, scope: applicationServiceDataScope(), assertCurrentAuthoritySync: check, assertCurrentAuthority: async () => check() });
  return { owner, facade, retire: () => { live = false; } };
}

test('revocation during a queue wait prevents later task dispatch and does not retire unrelated work', async () => {
  const f = fixture(); const pending: Promise<unknown>[] = [];
  try {
    await f.owner.run('fixture.echo', null);
    const occupied = f.owner.run('fixture.cpu', 100); pending.push(occupied);
    const queued = f.facade.run('fixture.echo', { private: 'must-not-be-returned' }); pending.push(queued);
    const rejection = queued.catch(error => error);
    await new Promise<void>(resolve => setTimeout(resolve, 5)); f.retire();
    await occupied;
    expect(await rejection).toMatchObject({ code: 'AUTH_STATE_CHANGED' });
    expect(await f.owner.run('fixture.echo', 'unrelated')).toMatchObject({ input: 'unrelated' });
  } finally { await f.owner.close(); await Promise.allSettled(pending); }
});

test('authority loss during execution withdraws results and closes that exact worker generation', async () => {
  const f = fixture(); let pending: Promise<unknown> | undefined;
  try {
    await f.owner.run('fixture.echo', null);
    pending = f.facade.run('fixture.cpu', 100); const rejection = pending.catch(error => error);
    await new Promise<void>(resolve => setTimeout(resolve, 10)); f.retire();
    expect(await rejection).toMatchObject({ code: 'WORKER_AUTHORITY_CHANGED', outcome: 'unknown' });
    expect(f.owner.status().processes).toBe(0);
    await expect(f.facade.run('fixture.echo', null)).rejects.toMatchObject({ code: 'AUTH_STATE_CHANGED' });
  } finally { await f.owner.close(); await pending?.catch(() => {}); }
});

test('request facades reject caller scope keys and cannot access process lifecycle methods', async () => {
  const f = fixture();
  try {
    expect(Object.keys(f.facade)).toEqual(['run']);
    await expect(f.facade.run('fixture.echo', null, { key: 'another-tenant' } as never)).rejects.toMatchObject({ code: 'WORKER_TASK_INVALID' });
    expect(f.owner.status().processes).toBe(0);
  } finally { await f.owner.close(); }
});
