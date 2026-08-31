import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, test } from 'bun:test';
import { resolveConfig } from '../frontend/server/types';
import { runUsageAudit } from './usage-audit';

const RULE = 'usage.backend.auth_stop_barrier_missing';

test('warns for unjoined standalone auth but not guarded auth or createApp', async () => {
  expect(await audit(`
    import { createAuthPlugin } from '@zero/framework/auth';
    const app = new Elysia().use(createAuthPlugin({ db }));
  `)).toContain(RULE);

  expect(await audit(`
    import {
      createAuthPlugin as auth,
      installAuthStopBarrier as withAuthStop,
    } from '@zero/framework/server';
    const app = withAuthStop(new Elysia().use(auth({ db })));
  `)).not.toContain(RULE);

  expect(await audit(`
    import { createApp } from '@zero/framework/server';
    const app = await createApp({ db: { mode: ':memory:' } });
  `)).not.toContain(RULE);
});

async function audit(source: string): Promise<string[]> {
  const root = await mkdtemp(join(tmpdir(), 'zero-auth-stop-audit-'));
  try {
    await mkdir(join(root, 'app'));
    await writeFile(join(root, 'app/server.ts'), source);
    return runUsageAudit({
      projectRoot: root,
      resolvedConfig: resolveConfig({
        db: { mode: ':memory:' },
        tables: { todos: { id: 'text primary key' } },
        auth: false,
        appDir: './app',
      }),
    }).map((finding) => finding.code);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
