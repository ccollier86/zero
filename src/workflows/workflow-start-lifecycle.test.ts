import { describe, expect, test } from 'bun:test';

import {
  ZERO_WORKFLOW_REGISTRY,
  ZERO_WORKFLOW_SERVICE,
} from '../runtime/service-keys';
import { ZeroAppRuntime } from '../runtime/zero-app-runtime';
import { createReactiveDB } from '../sync/reactive-db';
import { createWorkflowPlugin } from './workflow.plugin';

describe('workflow startup lifecycle', () => {
  test('does not publish a service when managed startup fails', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    const runtime = new ZeroAppRuntime('workflow-start-failure');
    let initialize!: () => Promise<void>;
    createWorkflowPlugin({
      db,
      runtime,
      ensureAuthReady: async () => {
        throw new Error('forced auth readiness failure');
      },
      onInitializerCreated(created) {
        initialize = created;
      },
    });

    try {
      expect(runtime.get(ZERO_WORKFLOW_REGISTRY)).not.toBeNull();
      await expect(initialize()).rejects.toThrow('forced auth readiness failure');
      expect(runtime.get(ZERO_WORKFLOW_SERVICE)).toBeNull();
      expect(runtime.get(ZERO_WORKFLOW_REGISTRY)).toBeNull();
    } finally {
      await runtime.dispose();
      db.dispose();
    }
  });
});
