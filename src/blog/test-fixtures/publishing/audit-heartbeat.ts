/** Native fixture collector: SDK-only callers, unlike AppProvider, must explicitly keep required delivery proof current. */
import type { Client } from '@zero/framework';
/** Uses authenticated observation acknowledgments, not a longer admission TTL or a protected-request retry. */
export async function publishingAuditHeartbeat(client: Pick<Client, 'logging'>): Promise<{ confirm(): Promise<void>; stop(): Promise<void> }> {
  const policy = await client.logging.collectionPolicy();
  if (!policy.delivery) throw new Error('Installed publishing qualification requires strict audit delivery.');
  let pending: Promise<void> | null = null, failed: unknown = null, stopped = false;
  const confirm = (): Promise<void> => {
    if (failed) return Promise.reject(failed);
    if (stopped) return Promise.reject(new Error('The synthetic audit collector is closed.'));
    return pending ??= client.logging.observe([], { policyVersion: policy.delivery!.policyVersion }).then(() => undefined).catch(error => { failed = error; throw error; }).finally(() => { pending = null; });
  };
  await confirm();
  const timer = setInterval(() => { void confirm().catch(() => { /* Retained and surfaced by confirm/stop; no automatic protected-operation retries. */ }); }, policy.heartbeatMs); timer.unref?.();
  return { confirm, async stop() { stopped = true; clearInterval(timer); await pending; if (failed) throw failed; } };
}
