/** Admit the actual deployment fixture against public registry contracts before packaging Linux probes. */
import { expect, test } from 'bun:test';
import { WorkflowRegistry } from '../workflows/workflow-registry';
import { installedJobsConfig } from './test-support/installed-deployment/fixture';

test('installed fixture registers one exact graph and pins its admitted activity over the newer default', async () => {
  const config = installedJobsConfig(), registry = new WorkflowRegistry();
  if (!config.workflows || !config.workflows.register) throw new Error('The deployment fixture must register its actual workflows.');
  await config.workflows.register(registry, { ai: null });
  expect(registry.listCompiledWorkflows()).toHaveLength(1);
  const graph = registry.getCompiledWorkflow('installed.workflow');
  expect(graph?.version).toBe(1);
  expect(registry.activities.resolve({ name: 'installed.activity' }).version).toBe('2');
  expect(registry.activities.resolve({ name: 'installed.activity', version: '1' }).capabilities).toEqual(['database']);
  expect(graph?.graph.nodes).toContainEqual(expect.objectContaining({ kind: 'activity', activity: { name: 'installed.activity', version: '1' } }));
});
