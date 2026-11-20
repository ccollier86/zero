/** Synthetic acceptance transport. Never prints credentials, request bodies or provider results. */
import { expect } from 'bun:test';
import type { Client } from '@zero/framework';
import type { UserAvatarAsset, UserAvatarSnapshot, UserAvatarStage } from '@zero/framework/auth';
import { publishingAuditHeartbeat } from './audit-heartbeat';
export const PASSWORD = 'Synthetic-installed-messaging-123!';
export async function request(origin: string, path: string, token?: string, body?: unknown, key?: string, method?: 'DELETE') {
  const response = await fetch(origin + path, { method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(key ? { 'Idempotency-Key': key } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) });
  const value = await response.json();
  if (!response.ok) throw Object.assign(new Error('Synthetic native request rejected.'), { status: response.status, code: value.code,
    route: path.split('?')[0]!.replace(/\/(conversations|attachments|messages|review)\/[^/]+/g, '/$1/:id') });
  return value as any;
}
/** Fixed valid PNGs are synthetic inputs; the framework must decode/normalize them itself. */
const avatarPng = [
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWMwDi3HihiGlgQA2DA/weuukJIAAAAASUVORK5CYII=',
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWOY6aKEFTEMLQkABv8/wQZuBi0AAAAASUVORK5CYII=',
] as const;
export async function replaceAvatar(origin: string, token: string, revision: number, variant: 0 | 1 = 0): Promise<UserAvatarSnapshot> {
  const stage: UserAvatarStage = await request(origin, '/auth/profile/avatar/stages', token, { expectedRevision: revision });
  const uploaded = await fetch(origin + '/storage/upload-grants/' + encodeURIComponent(stage.upload.token), {
    method: 'PUT', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'image/png' },
    body: Uint8Array.from(Buffer.from(avatarPng[variant], 'base64')), signal: AbortSignal.timeout(15000) });
  expect(uploaded.status).toBe(201); await uploaded.arrayBuffer();
  const snapshot: UserAvatarSnapshot = await request(origin, '/auth/profile/avatar/stages/' + stage.id + '/finalize', token, { receipt: stage.receipt });
  expect(snapshot.revision).toBe(revision + 1); expect(snapshot.asset).toMatchObject({ width: 64, height: 64, mimeType: 'image/webp' });
  expect(snapshot.publicAsset).toBeNull(); return snapshot;
}
export async function privateAvatarBytes(origin: string, token: string, asset: UserAvatarAsset): Promise<void> {
  const delivered = await fetch(origin + asset.deliveryPath, { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(15000) });
  expect(delivered.status).toBe(200); expect(delivered.headers.get('cache-control')).toContain('no-store');
  expect(delivered.headers.get('cross-origin-resource-policy')).toBe('same-origin'); expect(delivered.headers.get('x-content-type-options')).toBe('nosniff');
  expect(delivered.headers.get('content-type')).toBe('image/webp');
  const bytes = new Uint8Array(await delivered.arrayBuffer()); expect(bytes.byteLength).toBe(asset.byteLength);
  expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe('RIFF'); expect(new TextDecoder().decode(bytes.subarray(8, 12))).toBe('WEBP');
}
export async function acknowledge(origin: string, token: string) {
  const policy = await request(origin, '/api/_zero/logging/policy', token);
  await request(origin, '/api/_zero/logging/observations', token, { observations: [], policyVersion: policy.delivery.policyVersion });
}
/** Native HTTP identities do not own AppProvider; emulate its real policy-paced observation lifetime explicitly. */
export function keepAuditDelivery(origin: string, token: string) {
  const logging = { collectionPolicy: () => request(origin, '/api/_zero/logging/policy', token),
    observe: (observations: unknown[], options: { policyVersion: string }) => request(origin, '/api/_zero/logging/observations', token, { observations, policyVersion: options.policyVersion }) };
  return publishingAuditHeartbeat({ logging } as unknown as Pick<Client, 'logging'>);
}
export async function until(work: () => Promise<boolean> | boolean, label: string, timeout = 30000) {
  const end = Date.now() + timeout; while (!await work()) { if (Date.now() >= end) throw new Error(label + ' timed out.'); await Bun.sleep(30); }
}
export async function upload(origin: string, token: string, conversationId: string) {
  const bytes = new TextEncoder().encode('Synthetic retained installed private bytes'), checksum = new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
  const asset = await request(origin, '/api/messaging/conversations/' + conversationId + '/attachments', token,
    { fileName: 'retained.txt', mimeType: 'text/plain', sizeBytes: bytes.byteLength, checksum }, 'installed-attachment-allocation');
  const uploaded = await fetch(origin + '/api/messaging/conversations/' + conversationId + '/attachments/' + asset.id + '/content', { method: 'PUT', body: bytes,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/octet-stream', 'Idempotency-Key': 'installed-attachment-upload' } });
  expect(uploaded.status).toBe(200); return { id: asset.id, checksum, size: bytes.byteLength };
}
