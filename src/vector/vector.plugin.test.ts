import { describe, expect, test } from 'bun:test';

import { ZERO_OBSERVABILITY_RUNTIME, ZERO_VECTOR_SERVICE } from '../runtime/service-keys';
import { configureObservability } from '../observability';
import { ZeroAppRuntime } from '../runtime/zero-app-runtime';
import { resolveVectorConfig } from './vector-config';
import { VectorService } from './vector-service';
import { createVectorPlugin, getVectorStore } from './vector.plugin';

describe('createVectorPlugin lifecycle', () => {
  test('joins index disposal at the managed runtime boundary', async () => {
    let releaseDispose!: () => void;
    let disposeEntered!: () => void;
    const release = new Promise<void>((resolve) => { releaseDispose = resolve; });
    const entered = new Promise<void>((resolve) => { disposeEntered = resolve; });
    const service = {
      async dispose() {
        disposeEntered();
        await release;
      },
    } as unknown as VectorService;
    const config = resolveVectorConfig({
      defaultIndex: 'docs',
      indexes: { docs: 3 },
    }, {});
    if (config === false) throw new Error('Expected vector config.');
    const runtime = new ZeroAppRuntime('vector-stop-barrier');
    runtime.set(ZERO_OBSERVABILITY_RUNTIME, configureObservability(false));
    createVectorPlugin({ config, service, runtime });

    const disposing = runtime.dispose();
    await entered;
    expect(runtime.get(ZERO_VECTOR_SERVICE)).toBe(service);

    releaseDispose();
    await disposing;

    expect(runtime.get(ZERO_VECTOR_SERVICE)).toBeNull();
    expect(getVectorStore()).toBeNull();
  });
});
