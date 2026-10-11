/** Versioned activity adapters use the actual Torrent catalog and trusted attempt contracts. */
import { describe, expect, test } from 'bun:test';
import { WorkflowRegistry } from '../workflows/workflow-registry';
import type { StepContext } from '../workflows/types';
import { registerVectorVisualizationActivities } from './visualization-workflow';
import type { VectorVisualizationService } from './visualization-service';
import type { VectorVisualizationSnapshot } from './visualization-types';
import { VectorError } from './vector-error';

function context(input: unknown, overrides: Partial<StepContext> = {}): StepContext {
  return { input, workflowInput: input, instanceId: 'workflow:a', stepIndex: 0, attempt: 0,
    attemptId: 'physical:a', idempotencyKey: 'logical:a', signal: new AbortController().signal,
    execution: { kind: 'system', principal: 'trusted-test', reason: 'fixture', scopeKind: 'tenant',
      scopeId: 'tenant:a', tenantId: 'tenant:a', roles: [], permissions: [], allPermissions: true, legacyCompatibility: false },
    zero: null, assertCurrentAuthority() {}, ...overrides };
}
function snapshot(id: string, kind: VectorVisualizationSnapshot['kind']): VectorVisualizationSnapshot {
  return { id, kind, index: 'docs', revision: 1, status: 'completed',
    createdAt: '2026-10-09T00:00:00.000Z', updatedAt: '2026-10-09T00:00:00.000Z', stages: [] };
}

describe('registerVectorVisualizationActivities', () => {
  test('registers only explicit pinned activities, with database authoring disabled by default', () => {
    const registry = new WorkflowRegistry(); let resolutions = 0;
    const references = registerVectorVisualizationActivities(registry, { resolveService() { resolutions++; throw new Error('not executed'); } });
    expect(references.search).toEqual({ name: 'zero.vector.search', version: '1' });
    expect(registry.activities.list()).toHaveLength(2);
    expect(registry.listCompiledWorkflows()).toHaveLength(0); expect(resolutions).toBe(0);
    expect(() => registry.activities.resolveDatabaseCallable(references.search)).toThrow();
    const callable = new WorkflowRegistry();
    registerVectorVisualizationActivities(callable, { databaseCallable: true, resolveService() { throw new Error('not executed'); } });
    expect(callable.activities.resolveDatabaseCallable(references.search).databaseCallable).toBe(true);
    expect(() => registerVectorVisualizationActivities(registry, { resolveService() { throw new Error('not executed'); } })).toThrow();
    expect(registry.activities.list()).toHaveLength(2);
  });

  test('runtime attempts get separate progress identities while source revision and logical retry identity remain stable', async () => {
    const registry = new WorkflowRegistry();
    const calls: Array<{ operationId: string; sourceRevision?: string; signal?: AbortSignal }> = [];
    let authorityChecks = 0;
    const service = { async ingest(input, execution) {
      execution?.authorityFence?.(); calls.push({ operationId: input.operationId!, sourceRevision: input.sourceRevision, signal: execution?.signal });
      return snapshot(input.operationId!, 'ingestion');
    }, async search(input) { return snapshot(input.operationId!, 'search'); } } as Pick<VectorVisualizationService, 'ingest' | 'search'>;
    const references = registerVectorVisualizationActivities(registry, { resolveService(ctx) {
      expect(ctx.execution.scopeId).toBe('tenant:a'); return service;
    } });
    const handler = registry.activities.get(references.ingestion.name, '1')!.handler;
    const input = { document: { id: 'doc:a', title: 'Doc', text: 'Source text' } };
    const firstContext = context(input, { assertCurrentAuthority() { authorityChecks++; } });
    const first = await handler(firstContext) as { operationId: string };
    const retry = await handler(context(input, { attempt: 1, attemptId: 'physical:b' })) as { operationId: string };
    expect(first.operationId).not.toBe(retry.operationId);
    expect(calls[0]!.sourceRevision).toBe(calls[1]!.sourceRevision);
    expect(calls[0]!.signal).toBe(firstContext.signal);
    expect(authorityChecks).toBeGreaterThanOrEqual(4);
    await handler(context({ ...input, sourceRevision: 'source:v2' }, { attemptId: 'physical:c' }));
    expect(calls[2]!.sourceRevision).toBe('source:v2');
  });

  test('rejects caller-selected operation/scope credentials before the trusted resolver', async () => {
    const registry = new WorkflowRegistry(); let resolved = 0;
    const references = registerVectorVisualizationActivities(registry, { resolveService() { resolved++; throw new Error('not executed'); } });
    const handler = registry.activities.get(references.search.name, '1')!.handler;
    for (const input of [ { text: 'query', tenantId: 'other' }, { text: 'query', operationId: 'caller' },
      { text: 'query', apiKey: 'secret' } ]) await expect(handler(context(input))).rejects.toThrow();
    let accessed = 0;
    await expect(handler(context({ get text() { accessed++; return 'secret'; } }))).rejects.toThrow();
    expect(accessed).toBe(0); expect(resolved).toBe(0);
  });

  test('retired/missing attempts and non-completed business results cannot become successful workflow output', async () => {
    const registry = new WorkflowRegistry(); let calls = 0;
    const references = registerVectorVisualizationActivities(registry, { resolveService() {
      return { async search(input) { calls++; return { ...snapshot(input.operationId!, 'search'), status: 'interrupted' }; },
        async ingest(input) { return snapshot(input.operationId!, 'ingestion'); } } as Pick<VectorVisualizationService, 'search' | 'ingest'>;
    } });
    const handler = registry.activities.get(references.search.name, '1')!.handler;
    const aborted = new AbortController(); aborted.abort();
    await expect(handler(context({ text: 'query' }, { signal: aborted.signal }))).rejects.toBeInstanceOf(VectorError);
    await expect(handler(context({ text: 'query' }, { attemptId: undefined }))).rejects.toBeInstanceOf(VectorError);
    expect(calls).toBe(0);
    await expect(handler(context({ text: 'query' }))).rejects.toBeInstanceOf(VectorError);
    expect(calls).toBe(1);
  });
});
