/** Actual private logging workers and validators, with entirely synthetic provider effects. */
import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditAIModel } from '../ai/ai-execution-audit';
import { EmailService } from '../email/email-service';
import { EmailError } from '../email/email-error';
import { emitPlatformCodeTo, MemoryEventStore } from '../observability';
import { LoggingRuntime } from './logging-runtime';
import { resolveManagedLoggingConfig } from './logging-managed-config';
import { createManagedAIExecutionAudit } from './logging-ai-audit';
import { createManagedEmailSendAudit } from './logging-email-audit';
import { runWithLoggingAttribution } from './logging-attribution';
import { loggingContext } from './test-support/logging-fixture';
import { normalizeLoggingEvent } from './logging-validation';

const message = { from: 'sender@example.test', to: 'recipient@example.test', subject: 'PRIVATE_SUBJECT', text: 'PRIVATE_BODY' };
function observability() { const store = new MemoryEventStore(); return { sink: store, store, config: { console: false } }; }
function managedConfig(root: string) {
  const config = resolveManagedLoggingConfig({ rootDirectory: root, preset: 'compliance' }, root);
  if (!config) throw new Error('Synthetic managed logging must be enabled.');
  return config;
}
async function withRuntime(run: (runtime: LoggingRuntime, root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'logging-provider-'));
  const runtime = await LoggingRuntime.open(managedConfig(root), observability());
  try { await run(runtime, root); }
  finally { await runtime.close(); await rm(root, { recursive: true, force: true }); }
}
const serviceContext = () => ({ ...loggingContext('tenant-a'), correlationId: 'correlation-a',
  actor: { kind: 'service' as const, id: 'opaque-api-key', sessionId: null, initiatorId: 'initiating-user' } });

test('AI text, embedding and reranking confirmations preserve tenant, API-key initiator and invocation identity', () => withRuntime(async runtime => {
  const context = { ...serviceContext(), policyVersion: runtime.config.policyVersion };
  await runWithLoggingAttribution(runtime, context, () => {}, async () => {
    for (const method of ['doGenerate', 'doEmbed', 'doRerank'] as const) {
      const audit = createManagedAIExecutionAudit(() => runtime);
      const model = auditAIModel({ async [method]() { return { value: 'PRIVATE_RESULT' }; } },
        audit.prepare({ capability: method, providerId: 'PRIVATE_PROVIDER', model: 'PRIVATE_MODEL' }));
      expect(await model[method]!()).toEqual({ value: 'PRIVATE_RESULT' });
    }
  });
  const events = (await runtime.page('audit', { kind: 'tenant', tenantId: 'tenant-a' }, { family: 'ai' })).events.map(row => row.event);
  expect(events).toHaveLength(6);
  for (const terminal of events.filter(event => event.action === 'ai.provider.completed')) {
    expect(terminal).toMatchObject({ ...context, origin: 'provider', evidence: 'provider-confirmed', outcome: 'succeeded' });
    expect(normalizeLoggingEvent(JSON.parse(JSON.stringify(terminal)))).toEqual(terminal);
    const admission = events.find(event => event.target?.id === terminal.target?.id && event.action === 'ai.provider.admitted')!;
    expect(admission).toMatchObject({ ...context, evidence: 'server-confirmed', outcome: 'attempted' });
    expect(terminal.target).toEqual(admission.target);
  }
  expect((await runtime.page('audit', { kind: 'tenant', tenantId: 'tenant-b' })).events).toHaveLength(0);
  expect(JSON.stringify(events)).not.toContain('PRIVATE_');
}), 30000);

test('unconfirmed AI failures, incomplete streams, cancellation and stream errors never claim provider completion', () => withRuntime(async runtime => {
  const context = { ...serviceContext(), policyVersion: runtime.config.policyVersion };
  const audit = createManagedAIExecutionAudit(() => runtime);
  const prepare = () => audit.prepare({ capability: 'text', providerId: 'synthetic', model: 'synthetic/model' });
  await runWithLoggingAttribution(runtime, context, () => {}, async () => {
    const failure = new Error('PRIVATE_PROVIDER_ERROR');
    await expect(auditAIModel({ async doGenerate() { throw failure; } }, prepare()).doGenerate()).rejects.toBe(failure);
    for (const kind of ['eof', 'cancel', 'error-part', 'transport-error'] as const) {
      const model = auditAIModel({ async doStream() { return { stream: new ReadableStream({ start(controller) {
        if (kind === 'cancel') return;
        if (kind === 'error-part') controller.enqueue({ type: 'error', error: 'PRIVATE_PROVIDER_ERROR' });
        if (kind === 'transport-error') controller.error(failure); else controller.close();
      } }) }; } }, prepare());
      const { stream } = await model.doStream();
      if (kind === 'cancel') await stream.cancel();
      else {
        const reader = stream.getReader();
        const drain = async () => { while (!(await reader.read()).done) {} };
        try { if (kind === 'transport-error') await expect(drain()).rejects.toBe(failure); else await drain(); }
        finally { reader.releaseLock(); }
      }
    }
  });
  const events = (await runtime.page('audit', { kind: 'tenant', tenantId: 'tenant-a' }, { family: 'ai' })).events.map(row => row.event);
  expect(events).toHaveLength(10);
  expect(events.filter(event => event.evidence === 'provider-confirmed')).toHaveLength(0);
  const unknown = events.filter(event => event.action === 'ai.provider.unknown');
  expect(unknown).toHaveLength(5);
  for (const event of unknown) expect(event).toMatchObject({ ...context, outcome: 'unknown', evidence: 'incomplete' });
  expect(JSON.stringify(events)).not.toContain('PRIVATE_PROVIDER_ERROR');
}), 30000);

test('SMTP and Resend share valid accepted, partial, rejected and uncertain audit outcomes without retaining addresses', () => withRuntime(async runtime => {
  const context = { ...serviceContext(), policyVersion: runtime.config.policyVersion }, obs = observability();
  const emit: typeof import('../observability').emitPlatformCode = (code, options) => emitPlatformCodeTo(obs, code, options);
  let calls = 0;
  await runWithLoggingAttribution(runtime, context, () => {}, async () => {
    for (const name of ['smtp', 'resend']) for (const result of ['accepted', 'partial', 'rejected', 'denied', 'unknown']) {
      const service = new EmailService({ name, async send() {
        calls++;
        if (result === 'denied') throw new EmailError('PRIVATE_REJECTION', 'EMAIL_SEND_FAILED', 400);
        if (result === 'unknown') throw new Error('PRIVATE_PROVIDER_ERROR');
        return { provider: name, accepted: result === 'rejected' ? [] : [message.to], rejected: result === 'partial' || result === 'rejected' ? ['other@example.test'] : [] };
      } }, {}, emit, null, createManagedEmailSendAudit(() => runtime));
      if (result === 'denied' || result === 'unknown') await expect(service.send(message)).rejects.toMatchObject({ code: 'EMAIL_SEND_FAILED' });
      else expect((await service.send(message)).provider).toBe(name);
    }
  });
  expect(calls).toBe(10);
  const events = (await runtime.page('audit', { kind: 'tenant', tenantId: 'tenant-a' }, { family: 'communications' })).events.map(row => row.event);
  expect(events).toHaveLength(20);
  const confirmed = events.filter(event => event.evidence === 'provider-confirmed'); expect(confirmed).toHaveLength(4);
  for (const event of confirmed) {
    expect(event).toMatchObject({ ...context, origin: 'provider', action: 'email.provider.accepted', outcome: 'succeeded', metadata: { acceptedCount: 1 } });
    expect(normalizeLoggingEvent(JSON.parse(JSON.stringify(event)))).toEqual(event);
    expect(events.find(admission => admission.target?.id === event.target?.id && admission.action.endsWith('.admitted'))).toMatchObject(context);
  }
  expect(confirmed.filter(event => event.metadata.rejectedCount === 1)).toHaveLength(2);
  for (const event of events.filter(event => event.action === 'email.provider.rejected')) expect(event).toMatchObject({ ...context, evidence: 'server-confirmed', outcome: 'failed' });
  for (const event of events.filter(event => event.action === 'email.provider.unknown')) expect(event).toMatchObject({ ...context, evidence: 'incomplete', outcome: 'unknown' });
  expect(events.filter(event => event.action === 'email.provider.rejected')).toHaveLength(4);
  expect(events.filter(event => event.action === 'email.provider.unknown')).toHaveLength(2);
  expect(JSON.stringify(events)).not.toMatch(/example\.test|PRIVATE_/);
}), 30000);

test('genuine audit loss after email acceptance remains unknown and never repeats the provider send', () => withRuntime(async (runtime, root) => {
  let calls = 0;
  const obs = observability(), emit: typeof import('../observability').emitPlatformCode = (code, options) => emitPlatformCodeTo(obs, code, options);
  const service = new EmailService({ name: 'synthetic', async send() {
    calls++; await runtime.close(); return { provider: 'synthetic', accepted: [message.to] };
  } }, {}, emit, null, createManagedEmailSendAudit(() => runtime));
  await expect(service.send(message)).rejects.toMatchObject({ code: 'EMAIL_SEND_OUTCOME_UNKNOWN', status: 409 }); expect(calls).toBe(1);
  await expect(service.send(message)).rejects.toMatchObject({ code: 'LOGGING_CLOSED' }); expect(calls).toBe(1);
  const reopened = await LoggingRuntime.open(managedConfig(root), observability());
  try {
    const events = (await reopened.page('audit', { kind: 'platform' }, { family: 'communications' })).events.map(row => row.event);
    expect(events).toHaveLength(1); expect(events[0]).toMatchObject({ action: 'email.provider.admitted', origin: 'system', evidence: 'server-confirmed', outcome: 'attempted' });
  } finally { await reopened.close(); }
}), 30000);
