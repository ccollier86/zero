/** Fresh synthetic state is created by the installed source runtime before official bundled startup. */
import { createApp, defineZeroPlugin } from '@zero/framework/server';
import config from './zero.config';

const app = await createApp({ ...config, serverExtensions: [...config.serverExtensions!, defineZeroPlugin({
  name: 'source-preparation-proof', async setup({ zero }) {
    await zero.logging!.capture({ sourceId: 'source-prepared', origin: 'system', scope: { kind: 'application', tenantId: null },
      actor: { kind: 'system', id: 'qualification', sessionId: null, initiatorId: null }, requestId: null, correlationId: null,
      policyVersion: zero.logging!.config.policyVersion }, { id: 'source-prepared', family: 'workflow', action: 'fixture.source.prepared',
      outcome: 'succeeded', evidence: 'server-confirmed', occurredAt: 1800000000000 });
  },
})] });
await app.stop(true);
console.log(JSON.stringify({ sourcePrepared: true }));
