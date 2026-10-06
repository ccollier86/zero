import { describe, expect, test } from 'bun:test';
import { SignatureAgreementController } from './signature-agreement-controller';
import {
  acknowledgeSignatureAgreement,
  createSignatureAgreementPayload,
  normalizeSignatureAgreementReceipt,
} from './signature-agreement-model';
import type { SignaturePadStroke } from './signature-pad.types';

const strokes: readonly SignaturePadStroke[] = [{ points: [[10, 12, 2], [30, 22, 3]] }];
const acknowledgement = { signedAt: '2026-10-05T14:20:00.000Z', signerName: 'Approved name' };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('agreement snapshots and acknowledged lifecycle', () => {
  test('payload ink and SVG are immutable snapshots rather than aliases', () => {
    const mutable = [{ points: [[10, 12, 2] as [number, number, number]] }];
    const payload = createSignatureAgreementPayload(mutable, '  Casey  ');
    mutable[0].points[0][0] = 99;
    expect(payload.signerName).toBe('Casey');
    expect(payload.strokes[0].points[0][0]).toBe(10);
    expect(Object.isFrozen(payload)).toBe(true);
    expect(Object.isFrozen(payload.strokes[0].points[0])).toBe(true);
    const receipt = acknowledgeSignatureAgreement(payload, acknowledgement);
    expect(receipt.svg).toBe(payload.svg);
    expect(receipt.strokes).toEqual(payload.strokes);
    expect(receipt.signerName).toBe('Approved name');
  });

  test('receipt helper revalidates manually constructed payloads rather than trusting supplied SVG', () => {
    const mutable = [{ points: [[1, 2, 3] as [number, number, number]] }];
    const receipt = acknowledgeSignatureAgreement({ svg: '<svg onload="steal()"/>', strokes: mutable, signerName: 'Name' }, acknowledgement);
    mutable[0].points[0][0] = 99;
    expect(receipt.strokes[0].points[0][0]).toBe(1);
    expect(receipt.svg).not.toContain('steal');
  });

  test('empty and point-free ink cannot create a signature payload', () => {
    expect(() => createSignatureAgreementPayload([], 'Name')).toThrow();
    expect(() => createSignatureAgreementPayload([{ points: [] }], 'Name')).toThrow();
  });

  test('external SVG is ignored and canonicalized from validated strokes', () => {
    const receipt = normalizeSignatureAgreementReceipt({ ...acknowledgement, strokes, svg: '<svg onload="steal()"/>' });
    expect(receipt.svg).not.toContain('steal');
    expect(receipt.svg).toContain('<path');
    expect(() => normalizeSignatureAgreementReceipt({ ...acknowledgement, strokes: [{ points: [[NaN, 2, 3]] }] })).toThrow();
    expect(() => normalizeSignatureAgreementReceipt({ ...acknowledgement, strokes: [{ points: [], color: 'url(javascript:steal())' }] })).toThrow();
  });

  test('acknowledgements require an actual UTC ISO timestamp and do not invent dates', () => {
    const payload = createSignatureAgreementPayload(strokes, 'Name');
    for (const signedAt of ['', '2026-10-05', 'yesterday', '2026-02-30T12:00:00.000Z', '2026-10-05T12:00:00', '2026-10-05T12:00:00+01:00']) {
      expect(() => acknowledgeSignatureAgreement(payload, { signedAt })).toThrow();
    }
    expect(acknowledgeSignatureAgreement(payload, { signedAt: '2026-10-05T14:20:00Z' }).signedAt).toBe('2026-10-05T14:20:00Z');
  });

  test('signing locks only after acknowledgement and admits one pending callback', async () => {
    const controller = new SignatureAgreementController();
    const waiting = deferred<typeof acknowledgement>();
    const payload = createSignatureAgreementPayload(strokes, 'Name');
    let calls = 0;
    const onSign = () => { calls += 1; return waiting.promise; };
    const request = controller.sign(payload, onSign, () => true);
    expect(controller.getSnapshot().pending).toBe(true);
    expect(controller.getSnapshot().receipt).toBeNull();
    expect(await controller.sign(payload, onSign, () => true)).toBe('ignored');
    expect(calls).toBe(1);
    waiting.resolve(acknowledgement);
    expect(await request).toBe('signed');
    expect(controller.getSnapshot().pending).toBe(false);
    expect(controller.getSnapshot().receipt?.signedAt).toBe(acknowledgement.signedAt);
    expect(await controller.sign(payload, onSign, () => true)).toBe('ignored');
  });

  test('callback failures are content-free and leave a retryable draft', async () => {
    const controller = new SignatureAgreementController();
    const payload = createSignatureAgreementPayload(strokes, 'Private name');
    expect(await controller.sign(payload, () => { throw new Error('secret signature payload'); }, () => true)).toBe('failed');
    expect(controller.getSnapshot().receipt).toBeNull();
    expect(JSON.stringify(controller.getSnapshot().error)).not.toContain('secret');
    controller.clearError();
    expect(controller.getSnapshot().error).toBeNull();
    expect(await controller.sign(payload, async () => acknowledgement, () => true)).toBe('signed');
  });

  test('invalid receipts never lock the UI', async () => {
    const controller = new SignatureAgreementController();
    const payload = createSignatureAgreementPayload(strokes, 'Name');
    expect(await controller.sign(payload, async () => ({ signedAt: 'invalid' }), () => true)).toBe('failed');
    expect(controller.getSnapshot().receipt).toBeNull();
    expect(controller.getSnapshot().pending).toBe(false);
  });

  test('a retired source cannot sign after its old callback settles', async () => {
    const controller = new SignatureAgreementController();
    const waiting = deferred<typeof acknowledgement>();
    const request = controller.sign(createSignatureAgreementPayload(strokes, 'Name'), () => waiting.promise, () => true);
    controller.retire();
    waiting.resolve(acknowledgement);
    expect(await request).toBe('stale');
    expect(controller.getSnapshot().receipt).toBeNull();
    expect(controller.getSnapshot().pending).toBe(false);
  });

  test('retire and reactivate still fence old requests, including an A-B-A document lifetime', async () => {
    const controller = new SignatureAgreementController();
    const waiting = deferred<typeof acknowledgement>();
    const payload = createSignatureAgreementPayload(strokes, 'Name');
    const request = controller.sign(payload, () => waiting.promise, () => true);
    controller.retire();
    controller.activate();
    waiting.resolve(acknowledgement);
    expect(await request).toBe('stale');
    expect(controller.getSnapshot().receipt).toBeNull();
    expect(await controller.sign(payload, async () => acknowledgement, () => true)).toBe('signed');
  });

  test('an outside draft or authorization change retires the response without copying an old receipt', async () => {
    const controller = new SignatureAgreementController();
    const waiting = deferred<typeof acknowledgement>();
    let current = true;
    const request = controller.sign(createSignatureAgreementPayload(strokes, 'Name'), () => waiting.promise, () => current);
    current = false;
    waiting.resolve(acknowledgement);
    expect(await request).toBe('stale');
    expect(controller.getSnapshot().receipt).toBeNull();
    expect(controller.getSnapshot().pending).toBe(false);
  });

  test('prefilled acknowledgement supersedes an outstanding request and cannot be cleared by error reset', async () => {
    const controller = new SignatureAgreementController();
    const waiting = deferred<typeof acknowledgement>();
    const payload = createSignatureAgreementPayload(strokes, 'Name');
    const request = controller.sign(payload, () => waiting.promise, () => true);
    const received = acknowledgeSignatureAgreement(payload, { signedAt: '2026-10-05T15:00:00.000Z' });
    controller.acceptReceipt(received);
    waiting.resolve(acknowledgement);
    expect(await request).toBe('stale');
    controller.clearError();
    expect(controller.getSnapshot().receipt).toBe(received);
    expect(controller.getSnapshot().pending).toBe(false);
  });

  test('snapshot subscribers observe current state and can safely unsubscribe', async () => {
    const controller = new SignatureAgreementController();
    const snapshots: unknown[] = [];
    const unsubscribe = controller.subscribe(() => snapshots.push(controller.getSnapshot()));
    await controller.sign(createSignatureAgreementPayload(strokes, 'Name'), async () => acknowledgement, () => true);
    expect(snapshots.length).toBeGreaterThan(1);
    expect(Object.isFrozen(controller.getSnapshot())).toBe(true);
    unsubscribe();
    const count = snapshots.length;
    controller.acceptReceipt(acknowledgeSignatureAgreement(createSignatureAgreementPayload(strokes, 'Name'), acknowledgement));
    expect(snapshots).toHaveLength(count);
  });
});
