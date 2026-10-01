import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createWorkflowAppLifecycle } from './app-workflow-lifecycle';

describe('workflow app lifecycle boundary', () => {
  test('allows a later extension hook to wait for workflow readiness', async () => {
    let releasePlatform!: () => void;
    const platformGate = new Promise<void>((resolve) => { releasePlatform = resolve; });
    let publishWorkflow!: () => void;
    const workflowReady = new Promise<void>((resolve) => { publishWorkflow = resolve; });
    let initialized = false;
    let extensionReady = false;
    const app = new Elysia().onStart(async () => { await platformGate; });
    const lifecycle = createWorkflowAppLifecycle(app, () => true);

    lifecycle.captureDependencyBoundary();
    lifecycle.captureInitializer(async () => {
      await lifecycle.ensureDependenciesReady();
      initialized = true;
      publishWorkflow();
    });
    lifecycle.installStartupBoundary();
    // This models an app-owned extension mounted after workflows. Including it
    // in the dependency barrier would create extension -> workflow -> extension.
    app.onStart(async () => {
      await workflowReady;
      extensionReady = true;
    });

    app.listen(0);
    await Promise.resolve();
    expect(initialized).toBe(false);
    releasePlatform();
    await waitFor(() => initialized && extensionReady);
    expect({ initialized, extensionReady }).toEqual({
      initialized: true,
      extensionReady: true,
    });
    await app.stop();
  });

  test('does not include caller hooks added after the workflow boundary', async () => {
    let releaseLateHook!: () => void;
    const lateHookGate = new Promise<void>((resolve) => { releaseLateHook = resolve; });
    let initialized = false;
    let lateHookSettled = false;
    const app = new Elysia().onStart(() => undefined);
    const lifecycle = createWorkflowAppLifecycle(app, () => true);

    lifecycle.captureDependencyBoundary();
    lifecycle.captureInitializer(async () => {
      await lifecycle.ensureDependenciesReady();
      initialized = true;
    });
    lifecycle.installStartupBoundary();
    app.onStart(async () => {
      await lateHookGate;
      lateHookSettled = true;
    });

    app.listen(0);
    await waitFor(() => initialized);
    expect(lateHookSettled).toBe(false);
    releaseLateHook();
    await waitFor(() => lateHookSettled);
    await app.stop();
  });

  test('exposes only the exact captured workflow shutdown owner', async () => {
    const app = new Elysia();
    const lifecycle = createWorkflowAppLifecycle(app, () => true);
    let stops = 0;
    lifecycle.captureStopper(async () => { stops += 1; });

    await lifecycle.stopOwnedRuntime();
    expect(stops).toBe(1);
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Lifecycle condition did not settle');
}
