/** Reuse the existing tested SDK-only audit collector, never a second admission implementation. */
import { cp } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { createRequire } from 'node:module';
export async function prepareMessagingAuditFixture(directory: string): Promise<void> {
  const manifest = createRequire(join(directory, 'package.json')).resolve('@zero/framework/package.json');
  const source = new URL('./src/blog/test-fixtures/publishing/audit-heartbeat.ts', pathToFileURL(manifest));
  await cp(fileURLToPath(source), join(directory, 'audit-heartbeat.ts'));
}
