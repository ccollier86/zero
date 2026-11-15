/** Runtime alias plus strict-type compatibility; never replace the legacy local scheduler declaration. */
import { expect, test } from 'bun:test';
import type { DurableJobDefinition, JobDefinition as LocalTimerDefinition } from '../frontend/server';
import { defineJob, type JobDefinition } from './index';

const job = defineJob({ name: 'synthetic.public-contract', version: '1', workflow: { name: 'synthetic.work', version: 1 }, parseInput: input => input });
const fromRoot: DurableJobDefinition = job, fromDedicated: JobDefinition = fromRoot;
const localTimer: LocalTimerDefinition = { name: 'synthetic.local-timer', pattern: '* * * * * *', run() {} };
function rejectedConflation() {
  // @ts-expect-error The durable declaration is not the legacy in-memory timer API.
  const timer: LocalTimerDefinition = fromDedicated;
  // @ts-expect-error A callback/cron pattern cannot stand in for a sealed durable definition.
  const durable: DurableJobDefinition = localTimer;
  return { timer, durable };
}
void rejectedConflation;
test('durable root types coexist with the unchanged local scheduler JobDefinition', () => {
  expect(fromDedicated).toBe(job); expect(localTimer.pattern).toBe('* * * * * *');
});
