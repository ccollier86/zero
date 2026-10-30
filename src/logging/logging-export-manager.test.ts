/** Restart/pressure contracts for the bounded artifact scheduler; all provider effects are synthetic. */
import { expect, test } from 'bun:test';
import { LoggingExportManager, LOGGING_EXPORT_NAMESPACE } from './logging-export-manager';
import type { LoggingRuntime } from './logging-runtime';
import type { OwnedLoggingExportJob } from './logging-export-realm';
import type { StoragePrivateObjects } from '../storage/storage-private-objects';
import { captureLoggingEvent } from './logging-validation';

function job(id: string, expired = false): OwnedLoggingExportJob {
  const now = Date.now();
  return { scope: { kind: 'application' }, query: { highWaterOrdinal: 0 }, artifactRemoved: false,
    request: captureLoggingEvent({ sourceId: 'fixture', origin: 'system', scope: { kind: 'application', tenantId: null },
      actor: { kind: 'system', id: 'fixture', sessionId: null, initiatorId: null }, requestId: null, correlationId: null, policyVersion: 'fixture' }, {
      id, family: 'investigations', action: 'logging.export.requested', occurredAt: now, outcome: 'attempted', evidence: 'server-confirmed',
      target: { type: 'logging.export', id },
    }), job: { id, stream: 'audit', state: 'pending', createdAt: now, expiresAt: now + (expired ? -1 : 60000),
      completedAt: null, highWaterOrdinal: 0, count: 0, complete: false, nextBeforeOrdinal: null, sha256: null } };
}

test('a full 128-reservation sweep stays bounded and early failures do not starve later exports', async () => {
  const jobs = Array.from({ length: 128 }, (_, i) => job('export-' + i));
  let active = 0, peak = 0; const visited = new Set<string>(), artifacts = new Set<string>();
  const runtime = {
    async pendingExports() { return jobs; },
    async page() { return { events: [], hasMore: false, highWaterOrdinal: 0 }; },
    async evidenceCommand(_command: string, input: Record<string, unknown>) {
      const owned = jobs.find(j => j.job.id === input.id)!;
      return { ...owned, job: { ...owned.job, state: input.state } };
    },
  } as unknown as LoggingRuntime;
  const storage = { async put(namespace: string, id: string) {
    expect(namespace).toBe(LOGGING_EXPORT_NAMESPACE); visited.add(id); active++; peak = Math.max(peak, active);
    try { await Promise.resolve(); if (Number(id.slice(7)) < 4) throw new Error('Synthetic unavailable artifact'); artifacts.add(id); }
    finally { active--; }
  } } as unknown as StoragePrivateObjects;
  const owner = new LoggingExportManager(runtime, storage);
  try {
    await owner.reconcile();
    expect(visited.size).toBe(128); expect(artifacts.size).toBe(124);
    expect(peak).toBeLessThanOrEqual(4); expect(owner.diagnostics()).toMatchObject({ active: 0, failures: 4 });
  } finally { await owner.close(); }
});

test('restarting after a lost ready receipt uses the same artifact identity and bytes', async () => {
  let owned = job('retained-export'), transitions = 0; const artifacts = new Map<string, Uint8Array>();
  const runtime = {
    async pendingExports() { return owned.job.state === 'pending' ? [owned] : []; },
    async page() { return { events: [], hasMore: false, highWaterOrdinal: 0 }; },
    async evidenceCommand(_command: string, input: Record<string, unknown>) {
      transitions++; if (transitions === 1) throw new Error('Synthetic lost acknowledgment');
      owned = { ...owned, job: { ...owned.job, state: 'ready', sha256: input.sha256 as string } }; return owned;
    },
  } as unknown as LoggingRuntime;
  const storage = { async put(_namespace: string, id: string, bytes: Uint8Array) {
    if (artifacts.has(id)) expect(bytes).toEqual(artifacts.get(id)!); else artifacts.set(id, bytes.slice());
  } } as unknown as StoragePrivateObjects;
  const first = new LoggingExportManager(runtime, storage);
  await first.reconcile(); expect(owned.job.state).toBe('pending'); expect(artifacts.size).toBe(1); await first.close();
  const restarted = new LoggingExportManager(runtime, storage);
  try { await restarted.reconcile(); expect(owned.job.state).toBe('ready'); expect(artifacts.size).toBe(1); expect(transitions).toBe(2); }
  finally { await restarted.close(); }
});

test('expiration revokes access before provider cleanup and retries cleanup without releasing capacity early', async () => {
  let owned = job('expired-export', true), deleted = 0; const transitions: string[] = [];
  const runtime = {
    async pendingExports() { return owned.artifactRemoved ? [] : [owned]; },
    async evidenceCommand(_command: string, input: Record<string, unknown>) {
      transitions.push(String((input.auditEvent as { action: string }).action));
      owned = { ...owned, artifactRemoved: input.artifactRemoved === true, job: { ...owned.job, state: 'expired' } }; return owned;
    },
  } as unknown as LoggingRuntime;
  const storage = { async delete() {
    expect(owned.job.state).toBe('expired'); deleted++;
    if (deleted === 1) throw new Error('Synthetic cleanup interruption');
  } } as unknown as StoragePrivateObjects;
  const owner = new LoggingExportManager(runtime, storage);
  try {
    await owner.reconcile(); expect(owned.artifactRemoved).toBe(false);
    expect(transitions).toEqual(['logging.export.expired']);
    await owner.reconcile(); expect(owned.artifactRemoved).toBe(true); expect(deleted).toBe(2);
    expect(transitions).toEqual(['logging.export.expired', 'logging.export.artifact.removed']);
    await owner.reconcile(); expect(deleted).toBe(2);
  } finally { await owner.close(); }
});

test('activity export artifacts declare their v2 history contract without changing raw v1 artifacts', async () => {
  for (const projection of ['events', 'activities'] as const) {
    const original = job('format-' + projection);
    const owned = { ...original, query: { ...original.query, projection } };
    let bytes: Uint8Array | undefined;
    const runtime = {
      async page() { return { events: [], hasMore: false, highWaterOrdinal: 0 }; },
      async evidenceCommand(_command: string, input: Record<string, unknown>) { return { ...owned, job: { ...owned.job, state: input.state } }; },
    } as unknown as LoggingRuntime;
    const storage = { async put(_namespace: string, _id: string, artifact: Uint8Array) { bytes = artifact; } } as unknown as StoragePrivateObjects;
    const manager = new LoggingExportManager(runtime, storage);
    try {
      await manager.materialize(owned);
      const { manifest } = JSON.parse(new TextDecoder().decode(bytes).trim());
      expect(manifest).toMatchObject({ version: projection === 'activities' ? 2 : 1, complete: true, count: 0 });
      if (projection === 'activities') expect(manifest).toMatchObject({ projection, historyComplete: true });
      else expect(manifest).not.toHaveProperty('historyComplete');
    } finally { await manager.close(); }
  }
});
