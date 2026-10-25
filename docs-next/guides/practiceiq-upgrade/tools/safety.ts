/** safety.ts: confines preparation reports and offline copies to an explicit private rehearsal directory. */
import { constants, existsSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, closeSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const MARKER = '.zero-upgrade-rehearsal.json';
const PURPOSE = 'practiceiq-upgrade-verification-only';

/** Safe command failure; never attaches raw database, process or filesystem errors. */
export function fail(code: string): never { throw new Error(code); }

/** Canonical directory only; reject filesystem aliases and missing paths. */
export function directory(path: string): string {
  const absolute = resolve(path);
  if (!lstatSync(absolute).isDirectory() || realpathSync(absolute) !== absolute) fail('UPGRADE_DIRECTORY_INVALID');
  return absolute;
}

/** Whether a resolved target is inside a specified ownership root. */
export function inside(root: string, target: string): boolean {
  const path = relative(root, target);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

/** Resolve one regular file without following intermediate/final symlinks. */
export function regularFile(root: string, path: string): string {
  if (!path || isAbsolute(path) || path.includes('\\') || path.split('/').some(part => !part || part === '.' || part === '..')) fail('UPGRADE_FILE_INVALID');
  const parts = path.split('/');
  let current = root;
  for (let index = 0; index < parts.length; index++) {
    current = join(current, parts[index]!);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || (index === parts.length - 1 ? !stat.isFile() : !stat.isDirectory())) fail('UPGRADE_FILE_INVALID');
  }
  return current;
}

/** Create an empty private workspace; never reuse/overwrite a supplied directory. */
export function initializeRehearsal(project: string, target: string): string {
  project = directory(project);
  const root = resolve(target);
  directory(dirname(root));
  if (inside(project, root) || inside(root, project) || existsSync(root)) fail('UPGRADE_REHEARSAL_INVALID');
  mkdirSync(root, { mode: 0o700 });
  for (const name of ['source', 'candidate', 'evidence', 'temp']) mkdirSync(join(root, name), { mode: 0o700 });
  writeFileSync(join(root, MARKER), JSON.stringify({ schema: 1, purpose: PURPOSE }), { flag: 'wx', mode: 0o600 });
  return root;
}

/** Require an explicitly initialized, private directory outside the application. */
export function rehearsal(project: string, target: string): string {
  project = directory(project);
  const root = directory(target);
  if (inside(project, root) || inside(root, project) || (lstatSync(root).mode & 0o077) !== 0) fail('UPGRADE_REHEARSAL_INVALID');
  const marker = JSON.parse(readFileSync(regularFile(root, MARKER), 'utf8'));
  if (marker.schema !== 1 || marker.purpose !== PURPOSE) fail('UPGRADE_REHEARSAL_INVALID');
  const evidence = directory(join(root, 'evidence'));
  if ((lstatSync(evidence).mode & 0o077) !== 0) fail('UPGRADE_REHEARSAL_INVALID');
  return root;
}

/** Read bounded JSON evidence; only named files under the private evidence directory. */
export function readReport(root: string, name: string): unknown {
  const path = regularFile(root, `evidence/${reportName(name)}`);
  if (lstatSync(path).size > 32 * 1024 * 1024) fail('UPGRADE_REPORT_TOO_LARGE');
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Create a 0600 report exclusively; an existing report can never be replaced. */
export function writeReport(root: string, name: string, value: unknown): void {
  directory(join(root, 'evidence'));
  const path = join(root, 'evidence', reportName(name));
  const fd = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`); } finally { closeSync(fd); }
}

function reportName(name: string): string {
  if (!/^[a-z0-9][a-z0-9._-]{0,100}\.json$/.test(name)) fail('UPGRADE_REPORT_NAME_INVALID');
  return name;
}
