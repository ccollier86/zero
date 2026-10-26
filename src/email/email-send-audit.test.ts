/** Synthetic provider effects: audit admission and terminal failure must not manufacture delivery or duplicate sends. */
import { expect, test } from 'bun:test';
import { EmailService } from './email-service';
import type { EmailSendAudit } from './email-send-audit';
import { emitPlatformCode, emitPlatformCodeTo, MemoryEventStore } from '../observability';

const store = new MemoryEventStore();
const observability = { sink: store, store, config: { console: false } };
const emit: typeof emitPlatformCode = (definition, options) => emitPlatformCodeTo(observability, definition, options);

const message = { from: 'sender@example.test', to: 'recipient@example.test', subject: 'Private subject', text: 'Private email body' };

test('EmailService admits before provider work and records provider acceptance without message/contact fields', async () => {
  const events: unknown[] = []; let sent = 0;
  const audit: EmailSendAudit = { prepare(provider) { events.push(provider); return {
    async admit() { events.push('admitted'); }, async finish(outcome, counts) { events.push({ outcome, counts }); },
  }; } };
  const service = new EmailService({ name: 'synthetic', async send() { expect(events).toContain('admitted'); sent++; return { provider: 'synthetic', accepted: [message.to] }; } }, {}, emit, null, audit);
  expect((await service.send(message)).accepted).toEqual([message.to]); expect(sent).toBe(1);
  expect(events).toEqual(['synthetic', 'admitted', { outcome: 'accepted', counts: { acceptedCount: 1, rejectedCount: 0 } }]);
  expect(JSON.stringify(events)).not.toMatch(/recipient@example|Private subject|Private email body/);
});

test('failed audit admission performs no send; lost terminal audit after acceptance remains explicitly unknown', async () => {
  let sent = 0;
  const provider = { name: 'synthetic', async send() { sent++; return { provider: 'synthetic', accepted: [message.to] }; } };
  const denied = new EmailService(provider, {}, emit, null, { prepare() { return { async admit() { throw new Error('Audit unavailable'); }, async finish() {} }; } });
  await expect(denied.send(message)).rejects.toThrow('Audit unavailable'); expect(sent).toBe(0);
  const unresolved = new EmailService(provider, {}, emit, null, { prepare() { return { async admit() {}, async finish() { throw new Error('Receipt lost'); } }; } });
  await expect(unresolved.send(message)).rejects.toMatchObject({ code: 'EMAIL_SEND_OUTCOME_UNKNOWN', status: 409 }); expect(sent).toBe(1);
});

test('provider rejection and unresolved transport failures retain distinct stage outcomes', async () => {
  const outcomes: string[] = [];
  const audit: EmailSendAudit = { prepare() { return { async admit() {}, async finish(outcome) { outcomes.push(outcome); } }; } };
  const rejected = new EmailService({ name: 'synthetic', async send() { return { provider: 'synthetic', accepted: [], rejected: [message.to] }; } }, {}, emit, null, audit);
  await rejected.send(message);
  const failed = new EmailService({ name: 'synthetic', async send() { throw new Error('Private provider body'); } }, {}, emit, null, audit);
  await expect(failed.send(message)).rejects.toMatchObject({ code: 'EMAIL_SEND_FAILED' });
  expect(outcomes).toEqual(['rejected', 'unknown']);
});
