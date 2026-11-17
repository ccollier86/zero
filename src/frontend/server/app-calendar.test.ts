/** Disabled mount admission only; never starts an app, opens a database or builds/launches an actor. */
import { expect, test } from 'bun:test';
import type { Elysia } from 'elysia';
import type { ZeroAppRuntime } from '../../runtime/zero-app-runtime';
import { mountManagedCalendar } from './app-calendar';
import { resolveConfig } from './types';

test('omitted and false calendar mounts inspect no runtime/app dependency and invoke no startup callback', async () => {
  for (const calendar of [undefined, false] as const) {
    let touched = 0;
    const guarded = new Proxy({}, { get() { touched++; throw new Error('Disabled calendar touched a dependency.'); } });
    const config = resolveConfig({ projectRoot: '/synthetic-disabled-calendar', db: { mode: 'memory' }, tables: {}, calendar }, {});
    await mountManagedCalendar({ app: guarded as Elysia, runtime: guarded as ZeroAppRuntime, config,
      async startAuth() { touched++; throw new Error('Disabled calendar started Guardian.'); } });
    expect(touched).toBe(0);
  }
});
