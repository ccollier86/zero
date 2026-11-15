/** Short-lived, entirely synthetic native UI proof. SIGTERM/timeout always stops its owned server and retires CSS output. */
import { join } from 'node:path';
import { ownedWorkerFixture } from '../src/workers/test-support/owned-fixture';
import { buildBrowserFixture } from '../src/test-support/build-browser-fixture';
import { buildPlatformStyles } from '../src/frontend/server/style-bundle';

const fixture = await ownedWorkerFixture('jobs-workspace-browser');
let server: ReturnType<typeof Bun.serve> | undefined, stop: () => void = () => {};
const stopped = new Promise<void>(resolve => { stop = resolve; });
const onSignal = () => stop();
process.on('SIGTERM', onSignal); process.on('SIGINT', onSignal);
const timeout = setTimeout(stop, 10 * 60_000);
try {
  const compiled = await buildBrowserFixture(join(import.meta.dir, '../src/components/jobs/jobs-workspace.browser-fixture.tsx'));
  const style = await buildPlatformStyles(fixture.root, join(fixture.root, 'absent-app'));
  const css = await Bun.file(style.cssPath).text() + '\n' + compiled.css;
  server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === '/fixture.js') return new Response(compiled.script, { headers: { 'Content-Type': 'text/javascript' } });
    if (path === '/fixture.css') return new Response(css, { headers: { 'Content-Type': 'text/css' } });
    if (path !== '/') return new Response('Not found', { status: 404 });
    return new Response('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Synthetic jobs workspace</title><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  } });
  console.log(JSON.stringify({ purpose: 'synthetic-jobs-ui-only', url: `http://127.0.0.1:${server.port}`, fixture: fixture.root }));
  await stopped;
} finally {
  clearTimeout(timeout); process.off('SIGTERM', onSignal); process.off('SIGINT', onSignal);
  await server?.stop(true); await fixture.cleanup();
}
