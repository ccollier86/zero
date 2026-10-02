import { describe, expect, test } from 'bun:test';
import { t } from 'elysia';

import {
  choose,
  each,
  flow,
  otherwise,
  parallel,
  requestAndWait,
  step,
  waitFor,
  when,
} from './workflow-dsl';
import {
  compileFlow,
  compileWorkflowDefinition,
  fingerprintWorkflowDefinitionContent,
  stableWorkflowStringify,
  type WorkflowDefinitionInput,
} from './workflow-compiler';
import {
  evaluateWorkflowExpression,
  expr,
  validateWorkflowExpression,
} from './workflow-expression';
import {
  WORKFLOW_GRAPH_LIMITS,
  WORKFLOW_GRAPH_SCHEMA_VERSION,
  type WorkflowGraphIR,
} from './workflow-ir';
import { validateWorkflowGraphIR } from './workflow-ir-validator';
import { WorkflowActivityCatalog } from './workflow-activity-catalog';
import { WorkflowRegistry } from './workflow-registry';
import { toPublicWorkflowInstance } from './workflow-public-record';
import { toPublicWorkflowGraphTopology } from './workflow-public-topology';
import {
  normalizeWorkflowSchemaSnapshot,
  validateWorkflowSchemaValue,
} from './workflow-schema-snapshot';
import { WORKFLOW_SERVER_TABLE_NAMES, WORKFLOW_TABLES } from './types';

const handler = async () => ({ ok: true });

describe('workflow graph DSL and compiler', () => {
  test('exposes realtime-safe graph progress without private graph snapshots', () => {
    expect(WORKFLOW_TABLES.workflow_instances).toHaveProperty('definition_version');
    expect(WORKFLOW_TABLES.workflow_instances).toHaveProperty('graph_fingerprint');
    expect(WORKFLOW_TABLES.workflow_instances).not.toHaveProperty('definition_version_id');
    expect(WORKFLOW_TABLES.workflow_instances).not.toHaveProperty('graph_json');
    expect(WORKFLOW_TABLES.workflow_steps).toMatchObject({
      node_id: 'text',
      node_kind: 'text',
      node_path: 'text',
      branch_key: 'text',
      item_key: 'text',
      item_index: 'integer',
    });
    expect(WORKFLOW_TABLES.workflow_interactions).toHaveProperty('status');
    expect(WORKFLOW_TABLES.workflow_interactions).not.toHaveProperty('response_schema_json');
    expect(WORKFLOW_SERVER_TABLE_NAMES.has('workflow_definition_versions')).toBe(true);
    expect(WORKFLOW_SERVER_TABLE_NAMES.has('_workflow_memory')).toBe(true);
    expect(WORKFLOW_SERVER_TABLE_NAMES.has('_workflow_interaction_responses')).toBe(true);
    expect(WORKFLOW_SERVER_TABLE_NAMES.has('_workflow_event_usage')).toBe(true);
    expect(WORKFLOW_SERVER_TABLE_NAMES.has('_workflow_runtime_usage')).toBe(true);
    expect(WORKFLOW_SERVER_TABLE_NAMES.has('_workflow_runtime_owner_lease')).toBe(true);
    expect(toPublicWorkflowInstance({
      instance_id: 'run_1',
      definition_version_id: 'private-version-id',
      steps_json: '[private legacy topology]',
      graph_json: '{"private":"graph"}',
      graph_fingerprint: 'safe-fingerprint',
      input: '{"private":"input"}' as string | null,
      output: '{"private":"output"}' as string | null,
      error: 'private failure' as string | null,
    })).toEqual({
      instance_id: 'run_1',
      graph_fingerprint: 'safe-fingerprint',
      input: null,
      output: null,
      error: null,
    });
  });

  test('projects immutable run topology without executable definition details', () => {
    const graph: WorkflowGraphIR = {
      schemaVersion: 1,
      entry: 'load',
      nodes: [
        {
          id: 'load', kind: 'activity', label: 'Load records',
          activity: { name: 'private.activity.secret', version: 'private-version' },
          input: expr.literal('private-input'),
        },
        {
          id: 'approval', kind: 'wait', label: 'Approval',
          event: 'private.event.secret',
          inputSchema: { type: 'string', const: 'private-schema-secret' },
          interaction: { request: { prompt: 'private-request-secret' } },
        },
        {
          id: 'items', kind: 'each', concurrency: 1, onInvalid: 'fail', onError: 'fail',
          source: expr.literal(['private-array-secret']),
          itemKey: expr.item(),
          body: {
            schemaVersion: 1,
            entry: 'item',
            nodes: [{
              id: 'item', kind: 'activity', label: 'Process item',
              activity: { name: 'private.item.activity' },
            }],
            edges: [],
          },
        },
      ],
      edges: [
        { id: 'private-edge-one', from: 'load', to: 'approval' },
        {
          id: 'private-edge-two', from: 'approval', to: 'items',
          condition: expr.eq(expr.literal('private-condition-secret'), true),
        },
      ],
    };
    const topology = toPublicWorkflowGraphTopology({
      instance_id: 'run-1', tenant_id: 'tenant-1', definition_id: 'private-definition-id',
      name: 'intake', status: 'running', current_step: 0, input: 'private-run-input',
      output: null, error: null, started_by: 'user-1', steps_json: null,
      definition_version_id: 'private-version-id', definition_version: 4,
      graph_json: 'private-graph-json', graph_fingerprint: 'public-fingerprint',
      created_at: '2030-01-01T00:00:00.000Z', updated_at: '2030-01-01T00:00:00.000Z',
      completed_at: null,
    }, graph);

    expect(topology).toMatchObject({
      instanceId: 'run-1', name: 'intake', format: 'graph', schemaVersion: 1,
      definitionVersion: 4, graphFingerprint: 'public-fingerprint', entry: 'load',
    });
    expect(topology.nodes).toEqual([
      { id: 'load', path: 'load', kind: 'activity', label: 'Load records', parentPath: null, branchKey: null },
      { id: 'approval', path: 'approval', kind: 'wait', label: 'Approval', parentPath: null, branchKey: null },
      { id: 'items', path: 'items', kind: 'each', label: 'items', parentPath: null, branchKey: null },
      { id: 'item', path: 'items/item', kind: 'activity', label: 'Process item', parentPath: 'items', branchKey: null },
    ]);
    expect(topology.edges).toEqual([
      { id: 'edge.0', from: 'load', to: 'approval', branch: null, order: null, default: false },
      { id: 'edge.1', from: 'approval', to: 'items', branch: null, order: null, default: false },
    ]);
    const serialized = JSON.stringify(topology);
    for (const secret of [
      'private.activity.secret', 'private-version', 'private-input',
      'private.event.secret', 'private-schema-secret', 'private-request-secret',
      'private-array-secret', 'private.item.activity', 'private-condition-secret',
      'private-edge-one', 'private-edge-two', 'private-definition-id',
      'private-version-id', 'private-graph-json', 'private-run-input',
    ]) expect(serialized).not.toContain(secret);
  });

  test('compiles branches, parallel work, channel-neutral waits, and each into stable IR', () => {
    const registry = graphRegistry();
    const definition = graphDefinition();
    registry.create(definition);

    const compiled = registry.getCompiledWorkflow('patient-intake')!;
    expect(compiled.format).toBe('flow');
    expect(compiled.authoringSource).toBe('code');
    expect(compiled.version).toBe(7);
    expect(compiled.activate).toBe(false);
    expect(compiled.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(compiled.graph.schemaVersion).toBe(WORKFLOW_GRAPH_SCHEMA_VERSION);
    expect(Object.isFrozen(compiled.graph)).toBe(true);
    expect(Object.isFrozen(compiled.graph.nodes)).toBe(true);

    const load = compiled.graph.nodes.find((node) => node.id === 'load-patients');
    expect(load).toMatchObject({
      kind: 'activity',
      activity: { name: 'patients.load', version: '2' },
    });
    const wait = compiled.graph.nodes.find((node) => node.id === 'approval');
    expect(wait).toMatchObject({
      kind: 'wait',
      event: 'approval.submitted',
      interaction: {
        delivery: [{ activity: { name: 'email.send', version: '1' } }],
        validator: { name: 'approval.validate', version: '3' },
        maxRejections: 5,
      },
    });
    const fanout = compiled.graph.nodes.find((node) => node.id === 'check-patients');
    expect(fanout).toMatchObject({
      kind: 'each',
      concurrency: 4,
      onInvalid: 'skip',
      onError: 'collect',
      itemSchema: { type: 'object', required: ['id'] },
      body: { nodes: [{ kind: 'activity' }], edges: [] },
    });
    expect(compiled.graph.nodes.filter((node) => node.kind === 'join')).toHaveLength(2);
    expect(compiled.graphJson).not.toContain('function');
    expect(() => validateWorkflowGraphIR(compiled.graph)).not.toThrow();

    const second = graphRegistry();
    second.create(graphDefinition());
    expect(second.getCompiledWorkflow('patient-intake')?.fingerprint)
      .toBe(compiled.fingerprint);
    expect(second.getCompiledWorkflow('patient-intake')?.graphJson)
      .toBe(compiled.graphJson);
  });

  test('keeps exact legacy semantics in an immutable compatibility graph', () => {
    const registry = new WorkflowRegistry();
    registry.registerHandler('legacy.first', handler);
    registry.registerHandler('legacy.second', handler);
    registry.create({
      name: 'legacy',
      steps: [
        {
          name: 'Wait and check',
          handler: 'legacy.first',
          retries: 4,
          backoffMs: 25,
          timeoutMs: 1_000,
          waitFor: 'continue',
          condition: 'input.ready === true',
        },
        { name: 'Finish', handler: 'legacy.second' },
      ],
    });

    const compiled = registry.getCompiledWorkflow('legacy')!;
    expect(compiled.format).toBe('legacy');
    expect(compiled.legacySteps).toEqual(registry.getWorkflow('legacy')?.steps);
    expect(compiled.graph.nodes).toEqual([
      {
        id: 'legacy.0',
        kind: 'activity',
        label: 'Wait and check',
        activity: { name: 'legacy.first', version: '1' },
        retries: 4,
        backoffMs: 25,
        timeoutMs: 1_000,
        legacyCondition: 'input.ready === true',
        legacyWaitFor: 'continue',
      },
      {
        id: 'legacy.1',
        kind: 'activity',
        label: 'Finish',
        activity: { name: 'legacy.second', version: '1' },
      },
    ]);
    expect(compiled.graph.edges).toEqual([
      { id: 'edge.000000', from: 'legacy.0', to: 'legacy.1' },
    ]);
  });

  test('pins legacy handlers to their compatibility activity version', () => {
    const registry = new WorkflowRegistry();
    registry.registerHandler('shared', handler);
    registry.registerActivity({ name: 'shared', version: '2', handler });
    registry.activities.setDefault('shared', '2');
    registry.create({
      name: 'legacy-version',
      steps: [{ name: 'Legacy handler', handler: 'shared' }],
    });
    expect(registry.getCompiledWorkflow('legacy-version')?.graph.nodes[0])
      .toMatchObject({ activity: { name: 'shared', version: '1' } });
  });

  test('requires exactly one authoring format and one-activity each bodies', () => {
    const mixed = {
      name: 'mixed',
      steps: [{ name: 'Legacy', handler: 'noop' }],
      flow: flow(step('new', 'noop')),
    } as unknown as WorkflowDefinitionInput;
    expect(() => compileWorkflowDefinition(mixed)).toThrow(/exactly one/);

    expect(() => compileFlow(flow(each(
      'too-complex',
      expr.input('items'),
      flow(step('one', 'noop'), step('two', 'noop')),
    )))).toThrow(/exactly one activity/);
  });

  test('keeps request waits explicit and direct flow compilation canonical', () => {
    const compiled = compileFlow(flow(
      requestAndWait('approval', 'approval.received'),
    ));
    expect(compiled.nodes[0]).toMatchObject({
      id: 'approval',
      kind: 'wait',
      interaction: {},
    });
    expect(Object.isFrozen(compiled)).toBe(true);
    expect(Object.isFrozen(compiled.nodes)).toBe(true);

    const reordered = graph(
      [activity('b'), activity('a')],
      [edge('edge.1', 'a', 'b')],
      'a',
    );
    const ordered = graph(
      [activity('a'), activity('b')],
      [edge('edge.1', 'a', 'b')],
      'a',
    );
    expect(fingerprintWorkflowDefinitionContent(reordered))
      .toBe(fingerprintWorkflowDefinitionContent(ordered));

    const schema = t.Object({ patientId: t.String() });
    const roles = ['clinician'];
    const definition = compileWorkflowDefinition({
      name: 'immutable-envelope',
      graph: ordered,
      inputSchema: schema,
      access: { start: roles },
    });
    roles.push('later-mutation');
    expect(definition.access?.start).toEqual(['clinician']);
    expect(Object.isFrozen(definition.access)).toBe(true);
    expect(Object.isFrozen(definition.access?.start)).toBe(true);
    expect(Object.isFrozen(definition.inputSchema)).toBe(true);
    expect(stableWorkflowStringify(definition.inputSchema)).toContain('x-zero-typebox-kind');
    expect(validateWorkflowSchemaValue(definition.inputSchema, { patientId: 'patient-1' }))
      .toBe(true);
    expect(validateWorkflowSchemaValue(definition.inputSchema, { patientId: 42 })).toBe(false);
  });

  test('keeps every DSL descriptor JSON-safe and preserves useful choice labels', () => {
    const definition = flow(
      waitFor('ready', 'ready'),
      requestAndWait('approval', 'approval'),
      choose(
        'route',
        { label: 'Clinical routing' },
        when(expr.eq(expr.input('urgent'), true), step('urgent', 'noop')),
        otherwise(step('routine', 'noop')),
      ),
      each('items', expr.input('items'), flow(step('item', 'noop'))),
    );
    expect(() => stableWorkflowStringify(definition)).not.toThrow();
    expect(stableWorkflowStringify(definition)).not.toContain('undefined');
    expect(compileFlow(definition).nodes.find((node) => node.id === 'route'))
      .toMatchObject({ kind: 'choice', label: 'Clinical routing' });
  });

  test('orders parallel branches by code units independent of author insertion order', () => {
    const left = compileFlow(flow(parallel('work', {
      zeta: [step('zeta', 'noop')],
      Alpha: [step('alpha', 'noop')],
    })));
    const right = compileFlow(flow(parallel('work', {
      Alpha: [step('alpha', 'noop')],
      zeta: [step('zeta', 'noop')],
    })));
    expect(stableWorkflowStringify(left)).toBe(stableWorkflowStringify(right));
  });
});

describe('workflow graph validation', () => {
  test('rejects cycles, unreachable nodes, duplicates, and reserved ids', () => {
    const cycle = graph(
      [activity('a'), activity('b')],
      [edge('one', 'a', 'b'), edge('two', 'b', 'a')],
      'a',
    );
    expectGraphError(cycle, /cycle/);

    const unreachable = graph(
      [activity('a'), activity('orphan')],
      [],
      'a',
    );
    expectGraphError(unreachable, /unreachable/);

    const duplicate = graph(
      [activity('a'), activity('a')],
      [],
      'a',
    );
    expectGraphError(duplicate, /duplicate node/);

    const reserved = graph(
      [{ ...activity('@zero/not-a-join') }],
      [],
      '@zero/not-a-join',
    );
    expectGraphError(reserved, /reserved/);
  });

  test('requires a deterministic otherwise branch and rejects unreachable joins', () => {
    const compiled = compileFlow(flow(choose(
      'route',
      when(expr.eq(expr.input('kind'), 'a'), step('a', 'noop')),
      otherwise(step('b', 'noop')),
    )));
    const missingOtherwise = clone(compiled);
    const fallback = missingOtherwise.edges.find((candidate) => candidate.default);
    delete fallback!.default;
    expectGraphError(missingOtherwise, /otherwise/);

    const missingJoinPath = clone(compiled);
    missingJoinPath.edges = missingJoinPath.edges.filter((candidate) => (
      !(candidate.from === 'b' && candidate.to === '@zero/route/join')
    ));
    expectGraphError(missingJoinPath, /does not reach its join|unreachable/);
  });

  test('enforces aggregate graph limits before publication', () => {
    const nodes = Array.from(
      { length: WORKFLOW_GRAPH_LIMITS.maxNodes + 1 },
      (_, index) => activity(`node.${index}`),
    );
    const edges = nodes.slice(1).map((node, index) => edge(
      `edge.${index}`,
      nodes[index]!.id,
      node.id,
    ));
    expectGraphError(graph(nodes, edges, nodes[0]!.id), /too many nodes/);
  });

  test('requires explicit fan-out and joins and rejects depth bombs cleanly', () => {
    expectGraphError(graph(
      [activity('a'), activity('b'), activity('c')],
      [edge('ab', 'a', 'b'), edge('ac', 'a', 'c')],
      'a',
    ), /parallel for fan-out/);
    expectGraphError(graph(
      [
        { id: 'fork', kind: 'parallel', join: '@zero/fork/join' },
        activity('a'),
        activity('b'),
        activity('implicit-merge'),
        { id: '@zero/fork/join', kind: 'join', parent: 'fork', strategy: 'all' },
      ],
      [
        { id: 'fork-a', from: 'fork', to: 'a', branch: 'a' },
        { id: 'fork-b', from: 'fork', to: 'b', branch: 'b' },
        edge('a-merge', 'a', 'implicit-merge'),
        edge('b-merge', 'b', 'implicit-merge'),
        edge('merge-join', 'implicit-merge', '@zero/fork/join'),
      ],
      'fork',
    ), /generated join/);

    let literal: unknown = 'bottom';
    for (let index = 0; index < 2_000; index += 1) literal = { next: literal };
    const deep = graph([{
      ...activity('deep'),
      input: { type: 'literal', value: literal },
    } as WorkflowGraphIR['nodes'][number]], [], 'deep');
    expectGraphError(deep, /cannot exceed|too deeply nested/);
  });

  test('rejects a join that captures work from a sibling branch', () => {
    const outerJoin = '@zero/outer/join';
    const innerJoin = '@zero/inner/join';
    expectGraphError(graph(
      [
        { id: 'outer', kind: 'parallel', join: outerJoin },
        { id: 'inner', kind: 'parallel', join: innerJoin },
        activity('inside-a'),
        activity('inside-b'),
        activity('outside'),
        { id: innerJoin, kind: 'join', parent: 'inner', strategy: 'all' },
        { id: outerJoin, kind: 'join', parent: 'outer', strategy: 'all' },
      ],
      [
        { id: 'outer-inner', from: 'outer', to: 'inner', branch: 'inside' },
        { id: 'outer-outside', from: 'outer', to: 'outside', branch: 'outside' },
        { id: 'inner-a', from: 'inner', to: 'inside-a', branch: 'a' },
        { id: 'inner-b', from: 'inner', to: 'inside-b', branch: 'b' },
        edge('a-inner-join', 'inside-a', innerJoin),
        edge('b-inner-join', 'inside-b', innerJoin),
        edge('outside-inner-join', 'outside', innerJoin),
        edge('inner-outer-join', innerJoin, outerJoin),
      ],
      'outer',
    ), /captures a node outside/);
  });

  test('bounds labels, string payloads, and expression paths before publication', () => {
    expectGraphError(graph([{
      ...activity('long-label'),
      label: 'x'.repeat(WORKFLOW_GRAPH_LIMITS.maxLabelLength + 1),
    }], [], 'long-label'), /label/);
    expectGraphError(graph([{
      ...activity('large-literal'),
      input: expr.literal('x'.repeat(WORKFLOW_GRAPH_LIMITS.maxJsonStringLength + 1)),
    }], [], 'large-literal'), /too long|string data|bytes/);
    expect(() => expr.input(Array.from(
      { length: WORKFLOW_GRAPH_LIMITS.maxExpressionPathSegments + 1 },
      () => 'segment',
    ))).toThrow(/too many segments/);
  });

  test('requires named output references to exist and dominate their consumer', () => {
    expectGraphError(graph([{
      ...activity('start'), input: expr.output('missing'),
    }], [], 'start'), /unknown output/);
    expectGraphError(graph([
      { ...activity('first'), input: expr.output('later') },
      activity('later'),
    ], [edge('first-later', 'first', 'later')], 'first'), /not guaranteed/);

    expect(() => compileFlow(flow(
      choose(
        'route',
        when(expr.eq(expr.input('route'), 'a'), step('branch-a', 'noop')),
        otherwise(step('branch-b', 'noop')),
      ),
      step('after', 'noop', { input: expr.output('branch-a') }),
    ))).toThrow(/not guaranteed/);

    expect(() => compileFlow(flow(
      step('first', 'noop'),
      step('second', 'noop', { input: expr.output('first') }),
    ))).not.toThrow();
    expect(() => compileFlow(flow(
      step('top-level-item', 'noop', { input: expr.item() }),
    ))).toThrow(/cannot reference item/);
    expect(() => compileFlow(flow(requestAndWait(
      'approval',
      'approval.responded',
      {
        delivery: [{
          activity: { name: 'notify.approver' },
          input: expr.item(),
        }],
      },
    )))).toThrow(/cannot reference item/);
    expect(() => compileFlow(flow(each(
      'bad-key',
      expr.input('items'),
      flow(step('body', 'noop', { input: expr.item() })),
      { itemKey: expr.input('id') },
    )))).toThrow(/itemKey may reference only/);
  });
});

describe('workflow expression AST', () => {
  test('evaluates safe references and operators without executable source', () => {
    const condition = expr.and(
      expr.eq(expr.input('patient.active'), true),
      expr.gte(expr.output('coverage', 'score'), 80),
      expr.includes(expr.memory('allowedStates'), 'KY'),
      expr.eq(expr.itemIndex(), 2),
    );
    expect(evaluateWorkflowExpression(condition, {
      input: { patient: { active: true } },
      outputs: { coverage: { score: 92 } },
      memory: { allowedStates: ['TN', 'KY'] },
      itemIndex: 2,
    })).toBe(true);
    expect(stableWorkflowStringify(condition)).not.toContain('=>');
  });

  test('rejects prototype paths, malformed expressions, and non-JSON literals', () => {
    expect(() => expr.input('__proto__.polluted')).toThrow(/invalid segment/);
    expect(() => validateWorkflowExpression({
      type: 'compare', op: 'exec', left: expr.literal(1), right: expr.literal(1),
    })).toThrow(/operator/);
    expect(() => expr.literal(Number.NaN)).toThrow(/finite/);
  });

  test('does not read named outputs inherited through an object prototype', () => {
    const outputs = Object.create({ upstream: { secret: true } }) as Record<string, unknown>;
    expect(evaluateWorkflowExpression(expr.output('upstream', 'secret'), { outputs }))
      .toBeUndefined();
  });
});

describe('workflow activity catalog', () => {
  test('pins versions, validates schemas, and gates database-authored graphs', () => {
    const catalog = new WorkflowActivityCatalog();
    catalog.register({
      name: 'patient.lookup',
      version: '1',
      handler,
      inputSchema: t.Object({ id: t.String() }),
      outputSchema: t.Object({ ok: t.Boolean() }),
    });
    catalog.register({
      name: 'patient.lookup',
      version: '2',
      handler,
      databaseCallable: true,
      default: true,
      inputSchema: t.Object({ id: t.String() }),
      outputSchema: t.Object({ ok: t.Boolean() }),
      capabilities: ['database'],
    });

    expect(catalog.resolve({ name: 'patient.lookup' }).version).toBe('2');
    expect(catalog.resolveDatabaseCallable({ name: 'patient.lookup' }).version).toBe('2');
    expect(() => catalog.resolveDatabaseCallable({
      name: 'patient.lookup', version: '1',
    })).toThrow(/not allowed/);
    try {
      catalog.validateInput({ name: 'patient.lookup', version: '2' }, {});
      throw new Error('Expected input validation to fail');
    } catch (error) {
      expect(error).toMatchObject({ code: 'WORKFLOW_ACTIVITY_INPUT_INVALID' });
    }

    const registry = new WorkflowRegistry();
    registry.registerActivity({
      name: 'safe', version: '1', handler, databaseCallable: true,
    });
    registry.registerActivity({
      name: 'private', version: '1', handler,
    });
    registry.registerDatabaseWorkflow({
      name: 'database-safe',
      graph: graph([activity('safe-step', 'safe')], [], 'safe-step'),
    });
    expect(registry.getCompiledWorkflow('database-safe')?.graph.nodes[0])
      .toMatchObject({ activity: { name: 'safe', version: '1' } });
    expect(() => registry.registerDatabaseWorkflow({
      name: 'database-private',
      graph: graph([activity('private-step', 'private')], [], 'private-step'),
    })).toThrow(/not allowed/);
  });

  test('selects tied activity versions deterministically', () => {
    const first = new WorkflowActivityCatalog();
    first.register({ name: 'case', version: 'a', handler });
    first.register({ name: 'case', version: 'A', handler });
    const second = new WorkflowActivityCatalog();
    second.register({ name: 'case', version: 'A', handler });
    second.register({ name: 'case', version: 'a', handler });
    expect(first.resolve({ name: 'case' }).version)
      .toBe(second.resolve({ name: 'case' }).version);
  });

  test('keeps default metadata consistent and rejects competing defaults', () => {
    const catalog = new WorkflowActivityCatalog();
    catalog.register({ name: 'versioned', version: '1', handler, default: true });
    expect(() => catalog.register({
      name: 'versioned', version: '2', handler, default: true,
    })).toThrow(/already has a default/);
    catalog.register({ name: 'versioned', version: '2', handler });
    catalog.setDefault('versioned', '2');
    expect(catalog.resolve({ name: 'versioned' }).version).toBe('2');
    expect(catalog.get('versioned', '1')?.default).toBe(false);
    expect(catalog.get('versioned', '2')?.default).toBe(true);
    expect(catalog.list().filter((activity) => activity.default).map((activity) => activity.version))
      .toEqual(['2']);
  });

  test('never lets an invalid authoringSource bypass the database-callable gate', () => {
    const registry = new WorkflowRegistry();
    registry.registerActivity({ name: 'private', handler });
    expect(() => registry.registerWorkflow({
      name: 'invalid-source',
      graph: graph([activity('private-step', 'private')], [], 'private-step'),
    }, { authoringSource: 'database ' as 'database' })).toThrow(/authoringSource/);
  });
});

describe('workflow schema snapshots', () => {
  test('round-trips TypeBox metadata without treating property maps as schemas', () => {
    const schema = t.Object({
      patientId: t.String(),
      details: t.Optional(t.Object({ active: t.Boolean() })),
    });
    const snapshot = normalizeWorkflowSchemaSnapshot(schema);
    expect(() => stableWorkflowStringify(snapshot)).not.toThrow();
    expect(validateWorkflowSchemaValue(snapshot, { patientId: 'patient-1' })).toBe(true);
    expect(validateWorkflowSchemaValue(snapshot, {
      patientId: 'patient-1', details: { active: true },
    })).toBe(true);
    expect(validateWorkflowSchemaValue(snapshot, { patientId: 42 })).toBe(false);
    const transform = t.Transform(t.String())
      .Decode((value) => value.length)
      .Encode((value) => String(value));
    expect(() => normalizeWorkflowSchemaSnapshot(transform)).toThrow(/transforms/);
  });
});

function graphRegistry(): WorkflowRegistry {
  const registry = new WorkflowRegistry();
  registry.registerActivity({
    name: 'patients.load', version: '2', default: true, databaseCallable: true, handler,
  });
  registry.registerActivity({
    name: 'notify.team', version: '1', databaseCallable: true, handler,
  });
  registry.registerActivity({
    name: 'email.send', version: '1', databaseCallable: true, handler,
  });
  registry.registerActivity({
    name: 'audit.write', version: '4', databaseCallable: true, handler,
  });
  registry.registerActivity({
    name: 'approval.validate', version: '3', databaseCallable: true, handler,
  });
  registry.registerActivity({
    name: 'insurance.check', version: '1', databaseCallable: true, handler,
  });
  return registry;
}

function graphDefinition(): WorkflowDefinitionInput {
  return {
    name: 'patient-intake',
    version: 7,
    activate: false,
    flow: flow(
      step('load-patients', 'patients.load'),
      choose(
        'route',
        when(
          expr.eq(expr.output('load-patients', 'urgent'), true),
          step('notify-urgent', 'notify.team'),
        ),
        otherwise(step('continue-normal', 'audit.write')),
      ),
      parallel('outreach', {
        audit: [step('record-outreach', 'audit.write')],
        email: [step('send-summary', 'email.send')],
      }),
      requestAndWait('approval', 'approval.submitted', {
        delivery: ['email.send'],
        validator: 'approval.validate',
        maxRejections: 5,
        request: { title: 'Review patient intake' },
        inputSchema: { type: 'object', required: ['approved'] },
      }),
      each(
        'check-patients',
        expr.output('load-patients', 'patients'),
        flow(step('check-insurance', 'insurance.check', { input: expr.item() })),
        {
          concurrency: 4,
          itemSchema: { type: 'object', required: ['id'] },
          itemKey: expr.item('id'),
          onInvalid: 'skip',
          onError: 'collect',
        },
      ),
      waitFor('archive-ready', 'archive.ready', { timeoutMs: 60_000 }),
    ),
  };
}

function graph(
  nodes: WorkflowGraphIR['nodes'],
  edges: WorkflowGraphIR['edges'],
  entry: string,
): WorkflowGraphIR {
  return { schemaVersion: WORKFLOW_GRAPH_SCHEMA_VERSION, entry, nodes, edges };
}

function activity(id: string, name = 'noop') {
  return { id, kind: 'activity' as const, activity: { name } };
}

function edge(id: string, from: string, to: string) {
  return { id, from, to };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function expectGraphError(value: unknown, message: RegExp): void {
  try {
    validateWorkflowGraphIR(value);
    throw new Error('Expected graph validation to fail');
  } catch (error) {
    expect(error).toMatchObject({ code: 'WORKFLOW_GRAPH_INVALID', status: 422 });
    expect((error as Error).message).toMatch(message);
  }
}
