/** Child transport must not bootstrap its parent execution/lifecycle graph. No emitted files or processes. */
import { expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';

test('the child-side IPC server imports only the portable protocol, not parent executor machinery', async () => {
  const result = await Bun.build({ entrypoints: [fileURLToPath(new URL('./subprocess-database-server.ts', import.meta.url))],
    target: 'bun', metafile: true });
  expect(result.success).toBe(true);
  const metafile = typeof result.metafile === 'string' ? JSON.parse(result.metafile) : result.metafile;
  const inputs = Object.keys(metafile!.inputs);
  expect(inputs.some(value => value.endsWith('/subprocess-database-protocol.ts'))).toBe(true);
  expect(inputs.filter(value => /\/(?:subprocess-database-executor(?:-[^/]+)?|database-coordinator|database-actor-pool|database-working-directory)\.ts$/.test(value))).toEqual([]);
  expect(inputs.filter(value => /frontend\/server\/app-factory|\/ai\/ai-service|node_modules\/(?:react|react-dom)\//.test(value))).toEqual([]);
});
