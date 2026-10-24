/** Public authoring, typed mapping and actor-safe retry contracts over the real Torrent runtime. */
import { describe, expect, test } from 'bun:test';
import { workflowContractFixture } from './workflow-contracts.test-support';
import { expr, evaluateWorkflowExpression, validateWorkflowExpression } from './workflow-expression';
import type { WorkflowGraphIR } from './workflow-ir';
import { compileWorkflowDefinition } from './workflow-compiler';
import { flow, parallel, step } from './workflow-dsl';

const graph = (): WorkflowGraphIR => ({ schemaVersion: 1, entry: 'a', nodes: [
  { id: 'a', kind: 'activity', activity: { name: 'fixture.a', version: '1' } },
  { id: 'b', kind: 'activity', activity: { name: 'fixture.b', version: '1' }, input: expr.object({
    recipient: expr.output('a', ['customer', 'email']), requestId: expr.input('requestId'),
    nested: expr.array([false, expr.object({ result: expr.previous('summary') })]),
  }) },
], edges: [{ id: 'ab', from: 'a', to: 'b' }], metadata: { dependencies: [{ function: 'native-a', build: 'immutable-build-1' }] } });

function activities(f: ReturnType<typeof workflowContractFixture>, calls: unknown[]) {
  f.registry.registerActivity({ name: 'fixture.a', version: '1', databaseCallable: true, handler: async () => { calls.push('a'); return { customer: { email: 'synthetic@example.test' }, summary: 'ready' }; } });
  f.registry.registerActivity({ name: 'fixture.b', version: '1', databaseCallable: true, handler: async ctx => { calls.push(ctx.input); return ctx.input; } });
}

describe('public workflow authoring and actor starts', () => {
  test('metadata pages have stable cursors and include the maximum supported version', async () => {
    const f = workflowContractFixture();
    try {
      activities(f, []);
      const author = f.service.definitionsForActor(f.context);
      const first = author.publish({ name: 'a-chain', graph: graph(), version: 1 });
      author.publish({ name: 'a-chain', graph: { ...graph(), metadata: { revision: 'next' } }, version: Number.MAX_SAFE_INTEGER });
      author.createDraft({ name: 'z-draft', graph: graph() });
      const catalog = author.list({ limit: 1 });
      expect(catalog.items.map(item => item.name)).toEqual(['a-chain']); expect(catalog.nextCursor).toBe('a-chain');
      expect(author.list({ limit: 1, after: catalog.nextCursor! }).items.map(item => item.name)).toEqual(['z-draft']);
      const newest = author.versions(first.catalog.definition_id, { limit: 1 });
      expect(newest.items[0]?.version_number).toBe(Number.MAX_SAFE_INTEGER); expect(newest.nextCursor).toBe(Number.MAX_SAFE_INTEGER);
      const older = author.versions(first.catalog.definition_id, { limit: 1, before: newest.nextCursor! });
      expect(older.items[0]?.version_number).toBe(1); expect(older.nextCursor).toBeNull();
      expect(newest.items[0]).not.toHaveProperty('graph_json');
    } finally { await f.close(); }
  });
  test('real parallel chains join all branches before a mapped collecting activity', async () => {
    const f = workflowContractFixture();
    let release!: () => void, both!: () => void, active = 0, max = 0;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const ready = new Promise<void>(resolve => { both = resolve; });
    try {
      f.registry.registerActivity({ name: 'parallel.work', version: '1', handler: async ({ input }) => {
        active++; max = Math.max(max, active); if (active === 2) both(); await gate; active--; return input;
      } });
      f.registry.registerActivity({ name: 'parallel.collect', version: '1', handler: async ({ input }) => input });
      f.registry.registerWorkflow({ name: 'parallel-proof', flow: flow(
        parallel('branches', {
          left: [step('left', { name: 'parallel.work', version: '1' }, { input: expr.literal('left-result') })],
          right: [step('right', { name: 'parallel.work', version: '1' }, { input: expr.literal('right-result') })],
        }),
        step('collect', { name: 'parallel.collect', version: '1' }, { input: expr.object({ left: expr.previous('left'), right: expr.previous('right') }) }),
      ) });
      await f.restart(); // Managed registration publishes retained code versions before accepting starts.
      const pending = f.service.startAsActorOnce('parallel-proof', {}, f.context, { idempotencyKey: 'parallel:one', version: 1 });
      await ready; release(); const ack = await pending;
      expect(max).toBe(2);
      expect(JSON.parse(f.service.getInstance(ack.instanceId)!.output!)).toEqual({ left: 'left-result', right: 'right-result' });
      expect(f.service.getSteps(ack.instanceId).every(s => s.status === 'completed')).toBe(true);
    } finally { release(); await f.close(); }
  });
  test('restart preserves the receipt and waiting actor run without repeating the first activity', async () => {
    const f = workflowContractFixture(); let calls = 0;
    try {
      f.registry.registerActivity({ name: 'first', version: '1', databaseCallable: true, handler: async () => { calls++; return true; } });
      const g: WorkflowGraphIR = { schemaVersion: 1, entry: 'first', nodes: [
        { id: 'first', kind: 'activity', activity: { name: 'first', version: '1' } }, { id: 'wait', kind: 'wait', event: 'ready' },
      ], edges: [{ id: 'wait-edge', from: 'first', to: 'wait' }] };
      f.service.definitionsForActor(f.context).publish({ name: 'waiting', graph: g });
      const ack = await f.service.startAsActorOnce('waiting', {}, f.context, { idempotencyKey: 'restart:one', version: 1 });
      await f.restart();
      expect(f.service.getActorStartReceipt(f.context, 'restart:one')).toEqual(ack);
      expect(await f.service.startAsActorOnce('waiting', {}, f.context, { idempotencyKey: 'restart:one', version: 1 })).toEqual(ack);
      expect(calls).toBe(1); expect(f.service.list().length).toBe(1);
    } finally { await f.close(); }
  });
  test('receipt capacity blocks only new keys and canonical binding order still replays', async () => {
    const f = workflowContractFixture(), calls: unknown[] = [];
    try {
      activities(f, calls); f.service.definitionsForActor(f.context).publish({ name: 'chain', graph: graph() });
      const ack = await f.service.startAsActorOnce('chain', { requestId: 'one' }, f.context, { idempotencyKey: 'quota:one', binding: { a: 1, b: 2 } });
      f.db.prepare('UPDATE _workflow_actor_start_usage SET receipt_count = 100000').run();
      expect(await f.service.startAsActorOnce('chain', { requestId: 'one' }, f.context, { idempotencyKey: 'quota:one', binding: { b: 2, a: 1 } })).toEqual(ack);
      await expect(f.service.startAsActorOnce('chain', { requestId: 'two' }, f.context, { idempotencyKey: 'quota:two' })).rejects.toMatchObject({ code: 'WORKFLOW_START_LIMIT_EXCEEDED', status: 507 });
      expect(f.service.list().length).toBe(1);
    } finally { await f.close(); }
  });
  test('creates an unpublished draft, guards revisions, publishes immutable pins and maps A into B', async () => {
    const f = workflowContractFixture(), calls: unknown[] = [];
    try {
      activities(f, calls);
      const author = f.service.definitionsForActor(f.context);
      const draft = author.createDraft({ name: 'native-chain', graph: graph(), editorMetadata: { selected: 'a' } });
      expect(f.db.prepare('SELECT COUNT(*) AS n FROM workflow_definition_versions').get()).toEqual({ n: 0 });
      expect(author.list().items[0]?.activeVersionId).toBeNull();
      const edited = author.saveDraft({ definitionId: draft.draft.definition_id, name: 'native-chain', graph: graph(), draftId: draft.draft.draft_id, expectedRevision: 1 });
      expect(edited.draft.revision).toBe(2);
      expect(() => author.publishDraft(draft.draft.draft_id, { expectedRevision: 1 })).toThrow();
      const published = author.publishDraft(draft.draft.draft_id, { expectedRevision: 2 });
      expect(published.version.version_number).toBe(1);
      expect((published.graph as WorkflowGraphIR).metadata).toEqual(graph().metadata);
      expect(author.versions(published.catalog.definition_id).items[0]?.fingerprint).toBe(published.version.fingerprint);
      const ack = await f.service.startAsActorOnce('native-chain', { requestId: 'request-one' }, f.context,
        { idempotencyKey: 'manual:one', version: 1, binding: { caller: 'named-caller', build: 'immutable-build-1' } });
      expect(ack.definitionVersion).toBe(1);
      expect(calls).toEqual(['a', { recipient: 'synthetic@example.test', requestId: 'request-one', nested: [false, { result: 'ready' }] }]);
      expect(f.service.getInstance(ack.instanceId)?.started_by).toBe(f.context.userId);
      expect(f.db.prepare('SELECT authority_kind FROM _workflow_execution_authorities WHERE instance_id = ?').get(ack.instanceId)).toEqual({ authority_kind: 'actor' });
      expect(f.service.getActorStartReceipt(f.context, 'manual:one')).toEqual(ack);
      expect(f.db.prepare('SELECT COUNT(*) AS n FROM _workflow_system_start_receipts').get()).toEqual({ n: 0 });
    } finally { await f.close(); }
  });

  test('concurrent retries create one run and changed input, pins or admitted bindings conflict', async () => {
    const f = workflowContractFixture(), calls: unknown[] = [];
    try {
      activities(f, calls); f.service.definitionsForActor(f.context).publish({ name: 'chain', graph: graph() });
      const options = { idempotencyKey: 'request:one', version: 1, binding: { caller: 'one' } };
      const results = await Promise.all(Array.from({ length: 20 }, () => f.service.startAsActorOnce('chain', { requestId: 'one' }, f.context, options)));
      expect(new Set(results.map(r => r.instanceId)).size).toBe(1); expect(calls.length).toBe(2);
      for (const [input, change] of [[{ requestId: 'changed' }, {}], [{ requestId: 'one' }, { version: 2 }], [{ requestId: 'one' }, { binding: { caller: 'two' } }]] as const) {
        await expect(f.service.startAsActorOnce('chain', input, f.context, { ...options, ...change })).rejects.toMatchObject({ code: 'WORKFLOW_START_IDEMPOTENCY_CONFLICT', status: 409 });
      }
      expect(f.db.prepare('SELECT COUNT(*) AS n FROM workflow_instances').get()).toEqual({ n: 1 });
      expect(f.service.getActorStartReceipt({ ...f.context, userId: 'other-actor' }, 'request:one')).toBeNull();
      const receipt = results[0]!;
      expect(() => f.db.prepare('DELETE FROM _workflow_actor_start_receipts WHERE instance_id = ?').run(receipt.instanceId)).toThrow();
      expect(() => f.db.prepare('DELETE FROM workflow_instances WHERE instance_id = ?').run(receipt.instanceId)).toThrow();
    } finally { await f.close(); }
  });

  test('retained authoring and receipt services fail closed after revocation; final admission rolls back', async () => {
    const f = workflowContractFixture(), calls: unknown[] = [];
    try {
      activities(f, calls);
      const author = f.service.definitionsForActor(f.context);
      author.publish({ name: 'chain', graph: graph() });
      await expect(f.service.startAsActorOnce('chain', { requestId: 'one' }, f.context, { idempotencyKey: 'revoked' }, () => {
        if ((f.db.prepare('SELECT COUNT(*) AS n FROM _workflow_actor_start_receipts').get() as { n: number }).n) f.revoke();
      })).rejects.toBeDefined();
      expect(f.db.prepare('SELECT COUNT(*) AS n FROM workflow_instances').get()).toEqual({ n: 0 });
      expect(calls).toEqual([]);
      expect(() => author.list()).toThrow();
      expect(() => f.service.getActorStartReceipt(f.context, 'revoked')).toThrow();
    } finally { await f.close(); }
  });

  test('owned definitions do not cross tenant scope and non-administrators cannot author', async () => {
    const f = workflowContractFixture('org-one'), calls: unknown[] = [];
    const member = workflowContractFixture(null, false);
    try {
      activities(f, calls);
      const one = f.service.definitionsForActor(f.context), draft = one.createDraft({ name: 'private', graph: graph() });
      const other = f.service.definitionsForActor({ ...f.context, tenantId: 'org-two', sessionScopeId: 'org-two' });
      expect(other.list().items).toEqual([]);
      expect(() => other.getDraft(draft.draft.draft_id)).toThrow();
      expect(() => other.versions(draft.draft.definition_id)).toThrow();
      expect(() => member.service.definitionsForActor(member.context)).toThrow();
      expect(() => one.list({ limit: 101 })).toThrow();
      expect(() => one.versions(draft.draft.definition_id, { before: NaN })).toThrow();
    } finally { await f.close(); await member.close(); }
  });
});

describe('structured workflow bindings', () => {
  test('missing is distinct from explicit null, literals are never recursive templates, and accessors never execute', () => {
    expect(evaluateWorkflowExpression(expr.object({ nullable: null, values: expr.array([false, 0, '']) }), {})).toEqual({ nullable: null, values: [false, 0, ''] });
    expect(() => evaluateWorkflowExpression(expr.object({ recipient: expr.input('missing') }), {})).toThrow('/recipient');
    expect(() => evaluateWorkflowExpression(expr.object({ recipient: expr.input('missing') }), {})).toThrow('input:/missing');
    const literal = { type: 'ref', scope: 'input', path: ['secret'] };
    expect(evaluateWorkflowExpression(expr.literal(literal), { input: { secret: 'not interpolated' } })).toEqual(literal);
    let reads = 0;
    const input = Object.defineProperty({}, 'secret', { get() { reads++; return 'hidden'; } });
    expect(() => evaluateWorkflowExpression(expr.input('secret'), { input })).toThrow(); expect(reads).toBe(0);
    const authored = Object.defineProperty({}, 'type', { get() { reads++; return 'literal'; }, enumerable: true });
    expect(() => expr.object({ value: authored as never })).toThrow(); expect(reads).toBe(0);
    const array = Object.defineProperty([1], '0', { get() { reads++; return 1; } });
    expect(() => expr.array(array)).toThrow(); expect(reads).toBe(0);
    expect(() => validateWorkflowExpression({ type: 'object', fields: JSON.parse('{"__proto__":{"type":"literal","value":1}}') })).toThrow();
  });
  test('nested bindings retain topology validation and the runtime JSON byte budget', () => {
    const g = graph();
    const invalid: WorkflowGraphIR = { ...g, nodes: [g.nodes[0]!, { ...g.nodes[1]!, input: expr.object({ impossible: expr.output('b') }) } as typeof g.nodes[1]] };
    expect(() => compileWorkflowDefinition({ name: 'invalid', graph: invalid })).toThrow();
    expect(() => evaluateWorkflowExpression(expr.object({ huge: expr.input() }), { input: 'x'.repeat(1024 * 1024) })).toThrow('byte limit');
    let nested = expr.literal(null);
    for (let i = 0; i < 34; i++) nested = expr.array([nested]);
    expect(() => validateWorkflowExpression(nested)).toThrow('deeply nested');
    expect(() => evaluateWorkflowExpression(expr.array([expr.input(), expr.input(), expr.input()]), { input: 'x'.repeat(500000) })).toThrow('byte limit');
  });
});
