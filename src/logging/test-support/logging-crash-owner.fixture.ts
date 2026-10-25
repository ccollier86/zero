/** Disposable qualification owner. A marker follows a real worker commit; the test then SIGKILLs this process. */
import { join } from 'node:path';
import { LoggingRuntime } from '../logging-runtime';
import { resolveManagedLoggingConfig, type ResolvedManagedLoggingConfig } from '../logging-managed-config';
import { MemoryEventStore } from '../../observability/memory-event-store';
import { loggingEvent } from './logging-fixture';
import { runLoggingActorIfRequested } from '../logging-actor-bootstrap';
import { DatabaseError } from '../../databases/database-error';

if (!await runLoggingActorIfRequested()) {
  const [root, actor, mode] = process.argv.slice(2);
  if (!root || !actor) process.exit(64);
  const store = new MemoryEventStore();
  const config = resolveManagedLoggingConfig({ preset: 'activity', rootDirectory: join(root, 'logs'),
    actors: { launch: { kind: 'bundle', entrypoint: actor }, env: {} } }, root) as ResolvedManagedLoggingConfig;
  try {
    let logging: LoggingRuntime | undefined;
    const deadline = Date.now() + 10000;
    while (!logging) {
      try { logging = await LoggingRuntime.open(config, { sink: store, store, config: { console: false } }); }
      catch (error) {
        if (!(error instanceof DatabaseError) || error.code !== 'DATABASE_CONFLICT' || error.outcome !== 'not-started' || Date.now() >= deadline) throw error;
        await Bun.sleep(25);
      }
    }
    if (mode === 'verify') {
      const first = await logging.page('audit', { kind: 'tenant', tenantId: 'tenant-a' });
      const receipt = await logging.deliver(loggingEvent('compiled-before-kill'));
      const page = await logging.page('audit', { kind: 'tenant', tenantId: 'tenant-a' });
      const verification = await logging.verify('audit');
      await logging.close();
      await Bun.write(join(root, 'verified.json'), JSON.stringify({ first: first.events.map(row => row.event.id), after: page.events.length, duplicate: receipt.duplicate, checked: verification.checked, state: logging.diagnostics().state }));
    } else {
      await logging.deliver(loggingEvent('compiled-before-kill')); await logging.flush();
      await Bun.write(join(root, 'committed'), 'ready');
      await new Promise<void>(() => { setInterval(() => {}, 1000); });
    }
  } catch (error) {
    await Bun.write(join(root, 'failure.json'), JSON.stringify({ code: error instanceof DatabaseError ? error.code : 'FIXTURE_FAILED' }));
    // A fixture failure must not leave the test waiting on live actor channels.
    // The same parent-death fencing exercised by SIGKILL reaps these children.
    process.exit(70);
  }
}
