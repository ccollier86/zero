import { expect, test } from 'bun:test';
import { configureFrontendObservability, getFrontendObservabilitySink, type FrontendObservabilityEvent } from '../../frontend/client/observability';
import { observeSignatureCompositionCallback } from './signature-composition-callback';

test('signature composition notifications contain sync/async failures without emitting private data', async () => {
  const previous = getFrontendObservabilitySink();
  const events: FrontendObservabilityEvent[] = [];
  configureFrontendObservability({ sink: { emit: (event) => { events.push(event); } } });
  try {
    observeSignatureCompositionCallback(() => { throw new Error('private name and signature'); }, 'agreement-name');
    observeSignatureCompositionCallback(async () => { throw { signerName: 'private', svg: '<svg/>' }; }, 'clause-selection');
    await Promise.resolve();
    await Promise.resolve();
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.code)).toEqual(['frontend.signature_pad.callback_failed', 'frontend.signature_pad.callback_failed']);
    expect(events.map((event) => event.metadata)).toEqual([{ operation: 'agreement-name' }, { operation: 'clause-selection' }]);
    expect(events.every((event) => event.error === undefined)).toBe(true);
    expect(JSON.stringify(events)).not.toContain('private');
    expect(JSON.stringify(events)).not.toContain('<svg');
  } finally { configureFrontendObservability({ sink: previous }); }
});

test('a late failed notification from a retired signature composition emits no event', async () => {
  const previous = getFrontendObservabilitySink();
  const events: FrontendObservabilityEvent[] = [];
  configureFrontendObservability({ sink: { emit: (event) => { events.push(event); } } });
  let reject!: () => void;
  let current = true;
  const pending = new Promise<void>((_resolve, rejectPromise) => { reject = () => rejectPromise(new Error('private')); });
  try {
    observeSignatureCompositionCallback(() => pending, 'agreement-ink', () => current);
    current = false;
    reject();
    await Promise.resolve();
    await Promise.resolve();
    expect(events).toHaveLength(0);
  } finally { configureFrontendObservability({ sink: previous }); }
});
