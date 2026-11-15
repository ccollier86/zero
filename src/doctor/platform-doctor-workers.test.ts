import { expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { resolveWorkersConfig } from '../workers/config';
import { resolveAuthBehaviorConfig } from '../auth/auth-config';
import { defineWorkerTask } from '../workers/worker-task';
import { checkWorkers } from './platform-doctor-workers';
import type { PlatformDoctorFinding } from './platform-doctor-contracts';

test('worker Doctor checks are read-only, report missing entries and never invoke authored tasks/parsers or expose env values', () => {
  let calls = 0;
  const task = defineWorkerTask({ name: 'doctor.synthetic', version: '1', parseInput: value => { calls++; return value; },
    parseOutput: value => { calls++; return value; }, run: value => { calls++; return value; } });
  const configured = (entrypoint: string) => resolveWorkersConfig({ tasks: [task], launch: { kind: 'source', entrypoint },
    env: { SYNTHETIC_PRIVATE_TEST: 'PRIVATE_TEST_ENV_VALUE' } }, process.cwd(), resolveAuthBehaviorConfig({}));
  const disabled: PlatformDoctorFinding[] = []; checkWorkers({ workers: false }, disabled); expect(disabled).toEqual([]);
  const missing: PlatformDoctorFinding[] = [];
  checkWorkers({ workers: configured('/nonexistent/worker-hidden-deployment.ts') }, missing);
  expect(missing).toContainEqual(expect.objectContaining({ code: 'workers.launch.entry_missing', severity: 'error' }));
  const present: PlatformDoctorFinding[] = [];
  checkWorkers({ workers: configured(fileURLToPath(new URL('../workers/test-support/worker-entry.ts', import.meta.url))) }, present);
  expect(present).toContainEqual(expect.objectContaining({ code: 'workers.launch.entry_present', severity: 'info' }));
  expect(calls).toBe(0);
  expect(JSON.stringify([...missing, ...present])).not.toContain('PRIVATE_TEST_ENV_VALUE');
  expect(JSON.stringify(missing)).not.toContain('worker-hidden-deployment');
});
