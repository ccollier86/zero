/** Read-only worker deployment checks. Never starts a child or invokes a task/parser. */
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ResolvedConfig } from '../frontend/server/types';
import type { PlatformDoctorFindingSink } from './platform-doctor-contracts';

export function checkWorkers(config: Pick<ResolvedConfig, 'workers'>, findings: PlatformDoctorFindingSink): void {
  const workers = config.workers;
  if (!workers) return;
  const docs = './docs-next/backend/workers/index.md';
  if (workers.launch.kind === 'command-prefix') {
    findings.push({ severity: 'warning', code: 'workers.launch.wrapper_review', path: 'workers.launch', docs,
      message: 'Worker command-prefix launch requires an explicitly reviewed wrapper.',
      hint: 'Verify fixed arguments, empty/private cwd and no implicit dotenv/environment inheritance. Doctor does not execute the wrapper.' });
  } else {
    let present = false;
    try {
      const path = workers.launch.entrypoint instanceof URL ? fileURLToPath(workers.launch.entrypoint) : workers.launch.entrypoint;
      present = statSync(path).isFile();
    } catch { /* Fixed safe finding; never expose filesystem exception text. */ }
    findings.push({ severity: present ? 'info' : 'error', code: present ? 'workers.launch.entry_present' : 'workers.launch.entry_missing',
      path: 'workers.launch.entrypoint', docs,
      message: present ? 'The declared worker entry exists.' : 'The declared worker entry is missing or is not a regular file.',
      hint: present ? 'Existence alone does not qualify catalog parity, execution permissions, authority or deployment readiness.'
        : 'Ship the matching dedicated task entry/catalog or finish its build before running the app. Doctor never provisions or launches a replacement.' });
  }
  findings.push({ severity: 'info', code: 'workers.environment.explicit', path: 'workers.env', docs,
    message: 'Worker launch uses an explicit environment allowlist; no implicit parent environment is merged.',
    hint: 'Review authored allowlists instead of spreading process.env. A subprocess is not an OS permission sandbox. Doctor does not inspect secret values or invoke task code.' });
}
