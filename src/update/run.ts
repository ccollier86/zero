#!/usr/bin/env bun
/**
 * Safety-first updater for an existing Zero application.
 *
 * This command deliberately manages only the framework dependency, Bun's lock
 * files, and (for local installs) Zero's private framework archive. It never
 * copies templates or rewrites application source/data.
 */

import { createHash, randomUUID } from 'node:crypto';
import type { Stats } from 'node:fs';
import {
  copyFile,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  rmdir,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import {
  LOCAL_FRAMEWORK_DEPENDENCY,
  packLocalFramework,
  type LocalFrameworkPackage,
} from '../create-zero/local-framework-package';
import { bindBunLockToLocalArchive } from './bun-lock-integrity';
import {
  canonicalizeResolvedLocalArchiveLock,
  createLocalArchiveResolutionReference,
  createStagedPackageManifest,
  hasManagedLocalArchiveOverride,
  type LocalArchiveResolutionReference,
} from './local-archive-resolution';

const FRAMEWORK_PACKAGE = '@zero/framework';
const LOCAL_ARCHIVE_RELATIVE_PATH = join('.zero', 'framework', 'zero-framework.tgz');
const LOCK_FILES = ['bun.lock', 'bun.lockb'] as const;
const DEPENDENCY_SECTIONS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
] as const;

export type ZeroUpdateMode = 'registry' | 'local';

export interface ZeroUpdateOptions {
  projectDir: string;
  mode?: ZeroUpdateMode;
  localFrameworkDir?: string;
  latest?: boolean;
  dryRun?: boolean;
  /** Run the app's typecheck and doctor scripts after installation. Opt-in. */
  check?: boolean;
  /** Backwards-compatible explicit spelling for the safe default. */
  skipChecks?: boolean;
}

export interface UpdateCommandOptions {
  cwd: string;
  stdio: 'inherit' | 'pipe';
}

export interface UpdateCommandResult {
  exitCode: number;
  stdout?: string;
  stderr?: string;
}

export interface ZeroUpdateDependencies {
  cwd?: () => string;
  packLocalFramework?: (frameworkDir: string) => Promise<LocalFrameworkPackage>;
  verifyLocalInstall?: (archivePath: string, projectDir: string) => Promise<void>;
  runCommand?: (
    argv: string[],
    options: UpdateCommandOptions
  ) => Promise<UpdateCommandResult>;
  logger?: Pick<Console, 'log' | 'error'>;
}

export interface ZeroUpdateCheckResult {
  script: 'typecheck' | 'doctor';
  status: 'passed';
}

export interface ZeroUpdateResult {
  projectDir: string;
  mode: ZeroUpdateMode;
  dryRun: boolean;
  changed: boolean;
  dependencySection: string;
  dependencyBefore: string;
  dependencyAfter: string;
  versionBefore: string | null;
  versionAfter: string | null;
  archiveHashBefore: string | null;
  archiveHashAfter: string | null;
  checks: ZeroUpdateCheckResult[];
}

interface PackageJson extends Record<string, unknown> {
  name?: string;
  version?: string;
  scripts?: Record<string, unknown>;
}

interface DependencyLocation {
  section: (typeof DEPENDENCY_SECTIONS)[number];
  specifier: string;
}

interface ProjectState {
  projectDir: string;
  packagePath: string;
  packageBytes: Buffer;
  packageJson: PackageJson;
  dependency: DependencyLocation;
  lockPaths: string[];
  archivePath: string | null;
  archiveHash: string | null;
  installedVersion: string | null;
}

interface FileSnapshot {
  path: string;
  existed: boolean;
  backupPath: string;
}

interface DirectorySnapshot {
  path: string;
  existed: boolean;
}

interface UpdateSnapshot {
  directory: string;
  files: FileSnapshot[];
  managedDirectories: DirectorySnapshot[];
  installedFrameworkExisted: boolean;
  installedFrameworkBackup: string | null;
}

interface ProjectUpdateLock {
  path: string;
  release(): Promise<void>;
}

interface LocalArchiveResolutionSession {
  reference: LocalArchiveResolutionReference;
  stagedArchivePath: string;
}

interface ParsedCliArgs extends ZeroUpdateOptions {
  help: boolean;
}

export class ZeroUpdateError extends Error {
  readonly rollbackAttempted: boolean;
  readonly rollbackSucceeded: boolean | null;

  constructor(
    message: string,
    options: { cause?: unknown; rollbackAttempted?: boolean; rollbackSucceeded?: boolean | null } = {}
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ZeroUpdateError';
    this.rollbackAttempted = options.rollbackAttempted ?? false;
    this.rollbackSucceeded = options.rollbackSucceeded ?? null;
  }
}

/** Update one existing Zero project without regenerating any application files. */
export async function updateZeroProject(
  options: ZeroUpdateOptions,
  dependencies: ZeroUpdateDependencies = {}
): Promise<ZeroUpdateResult> {
  const mode = options.mode ?? (options.localFrameworkDir ? 'local' : 'registry');
  const dryRun = options.dryRun ?? false;
  const check = options.check ?? false;

  if (check && options.skipChecks) {
    throw new ZeroUpdateError('[zero update] --check and --skip-checks cannot be combined');
  }
  if (mode === 'local' && options.latest) {
    throw new ZeroUpdateError('[zero update] --latest cannot be combined with --local');
  }
  if (mode === 'local' && !options.localFrameworkDir) {
    throw new ZeroUpdateError('[zero update] Local mode requires a framework directory');
  }
  if (mode === 'registry' && options.localFrameworkDir) {
    throw new ZeroUpdateError('[zero update] A local framework directory requires local mode');
  }

  let state = await inspectProject(options.projectDir, mode);
  let localSource: { directory: string; version: string | null } | null = null;
  if (mode === 'local') {
    localSource = await inspectLocalFramework(options.localFrameworkDir!);
  }

  if (dryRun) {
    return {
      projectDir: state.projectDir,
      mode,
      dryRun: true,
      changed: false,
      dependencySection: state.dependency.section,
      dependencyBefore: state.dependency.specifier,
      dependencyAfter: state.dependency.specifier,
      versionBefore: state.installedVersion,
      versionAfter: mode === 'local' ? localSource!.version : null,
      archiveHashBefore: state.archiveHash,
      archiveHashAfter: null,
      checks: [],
    };
  }

  const runner = dependencies.runCommand ?? runCommand;
  const packer = dependencies.packLocalFramework ?? packLocalFramework;
  const verifier = dependencies.verifyLocalInstall ?? assertInstalledMatchesArchive;
  const logger = dependencies.logger ?? console;
  let packed: LocalFrameworkPackage | null = null;
  let packedHash: string | null = null;
  let snapshot: UpdateSnapshot | null = null;
  let updateLock: ProjectUpdateLock | null = null;
  let localResolution: LocalArchiveResolutionSession | null = null;
  let mutationStarted = false;
  let preserveSnapshot = false;

  try {
    if (mode === 'local') {
      packed = await packer(localSource!.directory);
      await assertRegularNonSymlinkFile(packed.archivePath, 'packed local framework archive');
      packedHash = await sha256File(packed.archivePath);
    }

    updateLock = await acquireProjectUpdateLock(state.projectDir);
    const currentState = await inspectProject(options.projectDir, mode);
    if (currentState.projectDir !== state.projectDir) {
      throw new ZeroUpdateError('[zero update] Project boundary changed while preparing the update');
    }
    state = currentState;
    snapshot = await snapshotProject(state);
    await assertSnapshotFilesUnchanged(snapshot, state.projectDir);

    if (mode === 'local') {
      mutationStarted = true;
      await ensureLocalManagedDirectories(state.projectDir);
      await atomicallyReplaceFile(packed!.archivePath, state.archivePath!, state.projectDir);
      localResolution = await stageLocalArchiveResolution(state);
    }

    mutationStarted = true;
    const installCommand = buildUpdateCommand(mode, options.latest ?? false);
    const installResult = await runner(installCommand, {
      cwd: state.projectDir,
      stdio: 'inherit',
    });
    if (installResult.exitCode !== 0) {
      throw new Error(commandFailureMessage('framework installation', installCommand, installResult));
    }
    if (mode === 'local') {
      const canonicalLockText = await finalizeLocalArchiveResolution(
        state,
        localResolution!
      );
      localResolution = null;
      const canonicalInstallResult = await runner(installCommand, {
        cwd: state.projectDir,
        stdio: 'inherit',
      });
      if (canonicalInstallResult.exitCode !== 0) {
        throw new Error(
          commandFailureMessage(
            'canonical framework installation',
            installCommand,
            canonicalInstallResult
          )
        );
      }
      await assertCanonicalInstallPreservedLock(state, canonicalLockText);
      await restoreLocalPackageManifestFormatting(state);
    }

    const after = await inspectUpdatedProject(state, mode, localSource?.version ?? null);
    if (mode === 'local' && packedHash !== after.archiveHash) {
      throw new Error('[zero update] Installed local archive does not match the packed framework');
    }
    if (mode === 'local') {
      await verifier(state.archivePath!, state.projectDir);
      await assertLocalArchiveLock(state);
    }

    const checks: ZeroUpdateCheckResult[] = [];
    if (check) {
      for (const script of availableSafeChecks(state.packageJson)) {
        const command = ['bun', 'run', script];
        const result = await runner(command, { cwd: state.projectDir, stdio: 'inherit' });
        if (result.exitCode !== 0) {
          throw new Error(commandFailureMessage(`${script} check`, command, result));
        }
        checks.push({ script, status: 'passed' });
      }
    }

    return {
      projectDir: state.projectDir,
      mode,
      dryRun: false,
      changed:
        state.dependency.specifier !== after.dependency.specifier ||
        state.installedVersion !== after.installedVersion ||
        state.archiveHash !== after.archiveHash,
      dependencySection: state.dependency.section,
      dependencyBefore: state.dependency.specifier,
      dependencyAfter: after.dependency.specifier,
      versionBefore: state.installedVersion,
      versionAfter: after.installedVersion,
      archiveHashBefore: state.archiveHash,
      archiveHashAfter: after.archiveHash,
      checks,
    };
  } catch (error) {
    if (!mutationStarted) {
      throw asUpdateError(error);
    }

    if (!snapshot) throw asUpdateError(error);
    if (localResolution) {
      try {
        await removeStagedLocalArchive(state.projectDir, localResolution);
        localResolution = null;
      } catch {
        // Rollback still restores the protected files. The guarded finally
        // cleanup retries the staged archive without following changed paths.
      }
    }
    const rollback = await rollbackProject(state, snapshot, runner);
    preserveSnapshot = !rollback.succeeded;
    const detail = error instanceof Error ? error.message : String(error);
    const rollbackDetail = rollback.succeeded
      ? 'The previous framework state was restored.'
      : `Rollback was incomplete: ${rollback.error}. Recovery backup preserved at ${snapshot.directory}`;
    throw new ZeroUpdateError(`[zero update] Update failed. ${rollbackDetail}\n${detail}`, {
      cause: error,
      rollbackAttempted: true,
      rollbackSucceeded: rollback.succeeded,
    });
  } finally {
    if (localResolution) {
      await removeStagedLocalArchive(state.projectDir, localResolution).catch((error) => {
        logger.error(
          `[zero update] Warning: could not remove staged local archive ${localResolution!.stagedArchivePath}: ${String(error)}`
        );
      });
    }
    if (packed) {
      await packed.cleanup().catch((error) => {
        logger.error(`[zero update] Warning: could not remove packed-update temporary files: ${String(error)}`);
      });
    }
    if (snapshot && !preserveSnapshot) {
      await rm(snapshot.directory, { recursive: true, force: true }).catch((error) => {
        logger.error(`[zero update] Warning: could not remove update backup ${snapshot!.directory}: ${String(error)}`);
      });
    }
    if (updateLock) {
      await updateLock.release().catch((error) => {
        logger.error(`[zero update] Warning: could not remove update lock ${updateLock!.path}: ${String(error)}`);
      });
    }
  }
}

/** Execute the `zero update` CLI and return a process exit code. */
export async function runZeroUpdateCli(
  args: string[] = Bun.argv.slice(2),
  dependencies: ZeroUpdateDependencies = {}
): Promise<number> {
  const logger = dependencies.logger ?? console;
  let parsed: ParsedCliArgs;
  try {
    const helpOnlyCwd = args.includes('--help') || args.includes('-h');
    parsed = parseZeroUpdateArgs(
      args,
      helpOnlyCwd ? process.cwd() : (dependencies.cwd?.() ?? process.cwd())
    );
  } catch (error) {
    logger.error(error instanceof Error ? error.message : error);
    return 1;
  }

  if (parsed.help) {
    printUsage(logger);
    return 0;
  }

  try {
    const result = await updateZeroProject(parsed, dependencies);
    printResult(result, logger, parsed.check ?? false);
    return 0;
  } catch (error) {
    logger.error(error instanceof Error ? error.message : error);
    return 1;
  }
}

export function parseZeroUpdateArgs(args: string[], cwd = process.cwd()): ParsedCliArgs {
  let projectDir = cwd;
  let localFrameworkDir: string | undefined;
  let latest = false;
  let dryRun = false;
  let check = false;
  let skipChecks = false;
  let help = false;

  const seen = new Set<string>();
  const mark = (flag: string): void => {
    if (seen.has(flag)) throw new ZeroUpdateError(`[zero update] Duplicate option: ${flag}`);
    seen.add(flag);
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case '--help':
      case '-h':
        help = true;
        break;
      case '--project': {
        mark('--project');
        const value = readOptionValue(args, index, '--project');
        projectDir = value;
        index += 1;
        break;
      }
      case '--local': {
        mark('--local');
        const value = readOptionValue(args, index, '--local');
        localFrameworkDir = value;
        index += 1;
        break;
      }
      case '--latest':
        mark('--latest');
        latest = true;
        break;
      case '--dry-run':
        mark('--dry-run');
        dryRun = true;
        break;
      case '--check':
        mark('--check');
        check = true;
        break;
      case '--skip-checks':
        mark('--skip-checks');
        skipChecks = true;
        break;
      default: {
        if (arg.startsWith('--project=')) {
          mark('--project');
          projectDir = readInlineOptionValue(arg, '--project');
          break;
        }
        if (arg.startsWith('--local=')) {
          mark('--local');
          localFrameworkDir = readInlineOptionValue(arg, '--local');
          break;
        }
        throw new ZeroUpdateError(`[zero update] Unknown option: ${arg}`);
      }
    }
  }

  if (localFrameworkDir && latest) {
    throw new ZeroUpdateError('[zero update] --latest cannot be combined with --local');
  }
  if (check && skipChecks) {
    throw new ZeroUpdateError('[zero update] --check and --skip-checks cannot be combined');
  }

  return {
    projectDir,
    mode: localFrameworkDir ? 'local' : 'registry',
    localFrameworkDir,
    latest,
    dryRun,
    check,
    skipChecks,
    help,
  };
}

function readOptionValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith('-')) {
    throw new ZeroUpdateError(`[zero update] ${flag} requires a directory path`);
  }
  return value;
}

function readInlineOptionValue(arg: string, flag: string): string {
  const value = arg.slice(`${flag}=`.length);
  if (!value) throw new ZeroUpdateError(`[zero update] ${flag} requires a directory path`);
  return value;
}

async function inspectProject(projectInput: string, mode: ZeroUpdateMode): Promise<ProjectState> {
  const requested = resolve(projectInput);
  let projectDir: string;
  try {
    projectDir = await realpath(requested);
  } catch {
    throw new ZeroUpdateError(`[zero update] Project directory does not exist: ${requested}`);
  }
  const projectStat = await stat(projectDir);
  if (!projectStat.isDirectory()) {
    throw new ZeroUpdateError(`[zero update] Project path is not a directory: ${projectDir}`);
  }

  const packagePath = join(projectDir, 'package.json');
  await assertRegularNonSymlinkFile(packagePath, 'project package.json');
  const packageBytes = await readFile(packagePath);
  const packageJson = parsePackageJson(packageBytes, packagePath);
  const dependency = findFrameworkDependency(packageJson);

  if (mode === 'local') {
    validateLocalSpecifier(dependency.specifier, projectDir);
    hasManagedLocalArchiveOverride(packageJson);
  } else {
    validateRegistrySpecifier(dependency.specifier);
  }

  const lockPaths: string[] = [];
  for (const lockName of LOCK_FILES) {
    const lockPath = join(projectDir, lockName);
    if (await pathExists(lockPath)) {
      await assertRegularNonSymlinkFile(lockPath, lockName);
      lockPaths.push(lockPath);
    }
  }
  if (lockPaths.length === 0) {
    throw new ZeroUpdateError(
      '[zero update] No bun.lock or bun.lockb found. Run `bun install` successfully before updating so rollback is deterministic.'
    );
  }
  if (lockPaths.length > 1) {
    throw new ZeroUpdateError(
      '[zero update] Both bun.lock and bun.lockb exist. Keep only the lockfile used by this project before updating.'
    );
  }
  if (mode === 'local' && basename(lockPaths[0]) !== 'bun.lock') {
    throw new ZeroUpdateError(
      '[zero update] Local archive updates require Bun\'s text bun.lock so archive integrity can be refreshed safely. Convert the legacy bun.lockb first.'
    );
  }

  let archivePath: string | null = null;
  let archiveHash: string | null = null;
  if (mode === 'local') {
    archivePath = join(projectDir, LOCAL_ARCHIVE_RELATIVE_PATH);
    archiveHash = await inspectLocalManagedArchive(projectDir, archivePath);
  }

  const installedVersion = await readInstalledFrameworkVersion(projectDir, false);
  return {
    projectDir,
    packagePath,
    packageBytes,
    packageJson,
    dependency,
    lockPaths,
    archivePath,
    archiveHash,
    installedVersion,
  };
}

async function inspectLocalFramework(
  frameworkInput: string
): Promise<{ directory: string; version: string | null }> {
  const requested = resolve(frameworkInput);
  let directory: string;
  try {
    directory = await realpath(requested);
  } catch {
    throw new ZeroUpdateError(`[zero update] Local framework directory does not exist: ${requested}`);
  }
  if (!(await stat(directory)).isDirectory()) {
    throw new ZeroUpdateError(`[zero update] Local framework path is not a directory: ${directory}`);
  }
  const packagePath = join(directory, 'package.json');
  await assertRegularNonSymlinkFile(packagePath, 'local framework package.json');
  const packageJson = parsePackageJson(await readFile(packagePath), packagePath);
  if (packageJson.name !== FRAMEWORK_PACKAGE) {
    throw new ZeroUpdateError(
      `[zero update] Local source is ${String(packageJson.name ?? 'an unnamed package')}, expected ${FRAMEWORK_PACKAGE}`
    );
  }
  return {
    directory,
    version: typeof packageJson.version === 'string' ? packageJson.version : null,
  };
}

function parsePackageJson(bytes: Buffer, path: string): PackageJson {
  try {
    const parsed: unknown = JSON.parse(bytes.toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    return parsed as PackageJson;
  } catch (error) {
    throw new ZeroUpdateError(`[zero update] Invalid JSON in ${path}`, { cause: error });
  }
}

function findFrameworkDependency(packageJson: PackageJson): DependencyLocation {
  const matches: DependencyLocation[] = [];
  for (const section of DEPENDENCY_SECTIONS) {
    const values = packageJson[section];
    if (!values || typeof values !== 'object' || Array.isArray(values)) continue;
    const specifier = (values as Record<string, unknown>)[FRAMEWORK_PACKAGE];
    if (specifier !== undefined) {
      if (typeof specifier !== 'string' || specifier.length === 0) {
        throw new ZeroUpdateError(`[zero update] ${FRAMEWORK_PACKAGE} has an invalid dependency value`);
      }
      matches.push({ section, specifier });
    }
  }
  if (matches.length === 0) {
    throw new ZeroUpdateError(`[zero update] ${FRAMEWORK_PACKAGE} is not declared in package.json`);
  }
  if (matches.length > 1) {
    throw new ZeroUpdateError(
      `[zero update] ${FRAMEWORK_PACKAGE} is declared in multiple dependency sections; resolve that conflict first`
    );
  }
  return matches[0];
}

function validateLocalSpecifier(specifier: string, projectDir: string): void {
  if (!specifier.startsWith('file:')) {
    throw new ZeroUpdateError(
      `[zero update] --local only updates projects already using ${LOCAL_FRAMEWORK_DEPENDENCY}`
    );
  }
  const rawPath = specifier.slice('file:'.length);
  const resolvedSpecifier = resolve(projectDir, rawPath);
  const expected = join(projectDir, LOCAL_ARCHIVE_RELATIVE_PATH);
  if (resolvedSpecifier !== expected || isAbsolute(rawPath)) {
    throw new ZeroUpdateError(
      `[zero update] --local only manages ${LOCAL_FRAMEWORK_DEPENDENCY}; found ${specifier}`
    );
  }
}

function validateRegistrySpecifier(specifier: string): void {
  const candidate = specifier.trim();
  const registryCharacters = /^[0-9A-Za-z*+._^~<>=| -]+$/;
  if (
    candidate !== specifier ||
    !candidate ||
    !registryCharacters.test(candidate) ||
    /[\\/:@#?]/.test(candidate) ||
    /[\u0000-\u001f\u007f]/.test(candidate)
  ) {
    throw new ZeroUpdateError(
      `[zero update] Registry mode refuses non-registry specifier ${specifier}. Use --local only for Zero's managed local archive.`
    );
  }
}

function localManagedDirectories(projectDir: string): string[] {
  return [join(projectDir, '.zero'), join(projectDir, '.zero', 'framework')];
}

async function inspectLocalManagedArchive(
  projectDir: string,
  archivePath: string
): Promise<string | null> {
  for (const path of localManagedDirectories(projectDir)) {
    const info = await safeLstat(path);
    if (!info) continue;
    if (info.isSymbolicLink()) {
      throw new ZeroUpdateError(`[zero update] Refusing symlinked managed path: ${path}`);
    }
    if (!info.isDirectory()) {
      throw new ZeroUpdateError(`[zero update] Managed local framework path is not a directory: ${path}`);
    }
  }

  const archiveInfo = await safeLstat(archivePath);
  if (!archiveInfo) return null;
  await assertRegularNonSymlinkFile(archivePath, 'local framework archive');
  const archiveRealPath = await realpath(archivePath);
  assertWithinProject(projectDir, archiveRealPath);
  return sha256File(archivePath);
}

async function assertLocalManagedPath(projectDir: string, archivePath: string): Promise<void> {
  if (await inspectLocalManagedArchive(projectDir, archivePath) === null) {
    throw new ZeroUpdateError(`[zero update] Missing local framework archive: ${archivePath}`);
  }
}

async function ensureLocalManagedDirectories(projectDir: string): Promise<void> {
  for (const path of localManagedDirectories(projectDir)) {
    await ensureManagedDirectory(projectDir, path);
  }
}

async function ensureManagedDirectory(projectDir: string, path: string): Promise<void> {
  await assertSafeManagedParent(projectDir, path);
  const before = await safeLstat(path);
  if (!before) {
    try {
      await mkdir(path);
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'EEXIST') throw error;
    }
  }

  await assertSafeManagedParent(projectDir, path);
  const after = await safeLstat(path);
  if (!after || after.isSymbolicLink() || !after.isDirectory()) {
    throw new ZeroUpdateError(`[zero update] Managed local framework path is not a safe directory: ${path}`);
  }
}

function assertWithinProject(projectDir: string, path: string): void {
  const rel = relative(projectDir, path);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new ZeroUpdateError(`[zero update] Managed path escapes the project: ${path}`);
  }
}

async function assertRegularNonSymlinkFile(path: string, label: string): Promise<void> {
  const info = await safeLstat(path);
  if (!info) throw new ZeroUpdateError(`[zero update] Missing ${label}: ${path}`);
  if (info.isSymbolicLink()) throw new ZeroUpdateError(`[zero update] Refusing symlinked ${label}: ${path}`);
  if (!info.isFile()) throw new ZeroUpdateError(`[zero update] ${label} is not a regular file: ${path}`);
}

async function acquireProjectUpdateLock(projectDir: string): Promise<ProjectUpdateLock> {
  const lockPath = join(projectDir, '.zero-update.lock');
  await assertSafeManagedParent(projectDir, lockPath);

  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(lockPath, 'wx', 0o600);
  } catch (error) {
    if (isNodeError(error) && error.code === 'EEXIST') {
      throw new ZeroUpdateError(
        `[zero update] Another update appears to be running for ${projectDir}. ` +
        `If it is not, inspect and remove the stale lock: ${lockPath}`
      );
    }
    throw error;
  }

  const openedStat = await handle.stat();
  try {
    await handle.writeFile(
      `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`,
      'utf8'
    );
  } catch (error) {
    await handle.close().catch(() => undefined);
    await removeOwnedUpdateLock(projectDir, lockPath, openedStat).catch(() => undefined);
    throw error;
  }

  return {
    path: lockPath,
    release: async () => {
      await handle.close();
      await removeOwnedUpdateLock(projectDir, lockPath, openedStat);
    },
  };
}

async function removeOwnedUpdateLock(
  projectDir: string,
  lockPath: string,
  openedStat: Stats
): Promise<void> {
  await assertSafeManagedParent(projectDir, lockPath);
  const current = await safeLstat(lockPath);
  if (!current) return;
  if (current.isSymbolicLink() || current.dev !== openedStat.dev || current.ino !== openedStat.ino) {
    throw new ZeroUpdateError(
      `[zero update] Update lock changed while held; refusing to remove it: ${lockPath}`
    );
  }
  await rm(lockPath, { force: true });
}

async function snapshotProject(state: ProjectState): Promise<UpdateSnapshot> {
  const directory = await mkdtemp(join(tmpdir(), 'zero-update-backup-'));
  const paths = [state.packagePath, ...LOCK_FILES.map((name) => join(state.projectDir, name))];
  if (state.archivePath) paths.push(state.archivePath);
  const files: FileSnapshot[] = [];

  try {
    const managedDirectories = state.archivePath
      ? await snapshotManagedDirectories(state.projectDir)
      : [];
    for (let index = 0; index < paths.length; index += 1) {
      const path = paths[index];
      await assertSafeManagedParent(state.projectDir, path);
      const existed = await pathExists(path);
      const backupPath = join(directory, `file-${index}-${basename(path)}`);
      if (existed) {
        await assertRegularNonSymlinkFile(path, `managed file ${basename(path)}`);
        await copyFile(path, backupPath);
      }
      files.push({ path, existed, backupPath });
    }

    const installedFramework = join(state.projectDir, 'node_modules', '@zero', 'framework');
    await assertSafeManagedParent(state.projectDir, installedFramework);
    let installedFrameworkBackup: string | null = null;
    const installedInfo = await safeLstat(installedFramework);
    if (installedInfo && (installedInfo.isSymbolicLink() || !installedInfo.isDirectory())) {
      throw new ZeroUpdateError(
        `[zero update] Installed framework changed type while preparing the update: ${installedFramework}`
      );
    }
    if (installedInfo) {
      installedFrameworkBackup = join(directory, 'installed-framework');
      await cp(installedFramework, installedFrameworkBackup, {
        recursive: true,
        force: true,
        dereference: false,
      });
    }
    return {
      directory,
      files,
      managedDirectories,
      installedFrameworkExisted: installedInfo !== null,
      installedFrameworkBackup,
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

async function snapshotManagedDirectories(projectDir: string): Promise<DirectorySnapshot[]> {
  const snapshots: DirectorySnapshot[] = [];
  for (const path of localManagedDirectories(projectDir)) {
    await assertSafeManagedParent(projectDir, path);
    const info = await safeLstat(path);
    if (info && (info.isSymbolicLink() || !info.isDirectory())) {
      throw new ZeroUpdateError(`[zero update] Invalid managed local framework directory: ${path}`);
    }
    snapshots.push({ path, existed: info !== null });
  }
  return snapshots;
}

async function assertSnapshotFilesUnchanged(
  snapshot: UpdateSnapshot,
  projectDir: string
): Promise<void> {
  for (const file of snapshot.files) {
    await assertSafeManagedParent(projectDir, file.path);
    const current = await safeLstat(file.path);
    if (!file.existed) {
      if (current) {
        throw new ZeroUpdateError(
          `[zero update] Managed file appeared while the update was being prepared: ${file.path}`
        );
      }
      continue;
    }
    if (!current || current.isSymbolicLink() || !current.isFile()) {
      throw new ZeroUpdateError(
        `[zero update] Managed file changed type while the update was being prepared: ${file.path}`
      );
    }
    const [before, now] = await Promise.all([readFile(file.backupPath), readFile(file.path)]);
    if (!before.equals(now)) {
      throw new ZeroUpdateError(
        `[zero update] Managed file changed while the update was being prepared; no update was applied: ${file.path}`
      );
    }
  }

  for (const directory of snapshot.managedDirectories) {
    await assertSafeManagedParent(projectDir, directory.path);
    const current = await safeLstat(directory.path);
    if (!directory.existed) {
      if (current) {
        throw new ZeroUpdateError(
          `[zero update] Managed directory appeared while the update was being prepared: ${directory.path}`
        );
      }
      continue;
    }
    if (!current || current.isSymbolicLink() || !current.isDirectory()) {
      throw new ZeroUpdateError(
        `[zero update] Managed directory changed type while the update was being prepared: ${directory.path}`
      );
    }
  }
}

async function inspectUpdatedProject(
  before: ProjectState,
  mode: ZeroUpdateMode,
  expectedLocalVersion: string | null
): Promise<{ dependency: DependencyLocation; installedVersion: string; archiveHash: string | null }> {
  await assertRegularNonSymlinkFile(before.packagePath, 'project package.json');
  const packageBytes = await readFile(before.packagePath);
  const packageJson = parsePackageJson(packageBytes, before.packagePath);
  const dependency = findFrameworkDependency(packageJson);

  if (dependency.section !== before.dependency.section) {
    throw new Error(`[zero update] Bun moved ${FRAMEWORK_PACKAGE} to another dependency section`);
  }
  assertOnlyFrameworkDependencyChanged(before.packageJson, packageJson, before.dependency.section);
  if (mode === 'local') {
    validateLocalSpecifier(dependency.specifier, before.projectDir);
    if (!packageBytes.equals(before.packageBytes)) {
      throw new Error('[zero update] Local update unexpectedly changed package.json');
    }
  } else {
    validateRegistrySpecifier(dependency.specifier);
  }

  for (const lockPath of before.lockPaths) {
    await assertRegularNonSymlinkFile(lockPath, basename(lockPath));
  }
  for (const lockName of LOCK_FILES) {
    const lockPath = join(before.projectDir, lockName);
    if (!before.lockPaths.includes(lockPath) && await pathExists(lockPath)) {
      throw new Error(`[zero update] Bun created an unexpected second lockfile: ${lockPath}`);
    }
  }
  const installedVersion = await readInstalledFrameworkVersion(before.projectDir, true);
  if (installedVersion === null) {
    throw new Error(`[zero update] Bun did not install ${FRAMEWORK_PACKAGE}`);
  }
  if (mode === 'local' && expectedLocalVersion && installedVersion !== expectedLocalVersion) {
    throw new Error(
      `[zero update] Installed framework version ${installedVersion} does not match local source ${expectedLocalVersion}`
    );
  }
  if (before.archivePath) await assertLocalManagedPath(before.projectDir, before.archivePath);
  const archiveHash = before.archivePath ? await sha256File(before.archivePath) : null;
  return { dependency, installedVersion, archiveHash };
}

function assertOnlyFrameworkDependencyChanged(
  before: PackageJson,
  after: PackageJson,
  section: DependencyLocation['section']
): void {
  const normalizedAfter = structuredClone(after);
  const normalizedSection = normalizedAfter[section] as Record<string, unknown>;
  const beforeSection = before[section] as Record<string, unknown>;
  normalizedSection[FRAMEWORK_PACKAGE] = beforeSection[FRAMEWORK_PACKAGE];
  if (!isDeepStrictEqual(before, normalizedAfter)) {
    throw new Error(
      `[zero update] package.json changed outside the ${FRAMEWORK_PACKAGE} dependency; refusing the update`
    );
  }
}

async function readInstalledFrameworkVersion(projectDir: string, required: boolean): Promise<string | null> {
  const path = join(projectDir, 'node_modules', '@zero', 'framework', 'package.json');
  await assertSafeManagedParent(projectDir, path);
  const info = await safeLstat(path);
  if (!info) {
    if (required) throw new Error(`[zero update] Bun did not install ${FRAMEWORK_PACKAGE}`);
    return null;
  }
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new ZeroUpdateError(`[zero update] Invalid installed framework package.json: ${path}`);
  }
  const packageJson = parsePackageJson(await readFile(path), path);
  if (packageJson.name !== FRAMEWORK_PACKAGE || typeof packageJson.version !== 'string') {
    throw new Error(`[zero update] Installed package is not a valid ${FRAMEWORK_PACKAGE}`);
  }
  return packageJson.version;
}

async function assertInstalledMatchesArchive(archivePath: string, projectDir: string): Promise<void> {
  let archiveFiles: Map<string, File>;
  try {
    const archive = new Bun.Archive(await readFile(archivePath));
    archiveFiles = await archive.files();
  } catch (error) {
    throw new ZeroUpdateError('[zero update] Could not inspect the packed local framework archive', {
      cause: error,
    });
  }

  const installedRoot = join(projectDir, 'node_modules', '@zero', 'framework');
  const expected = new Map<string, File>();
  for (const [archiveName, file] of archiveFiles) {
    if (!archiveName.startsWith('package/')) {
      throw new ZeroUpdateError(
        `[zero update] Packed framework contains an unexpected archive path: ${archiveName}`
      );
    }
    const relativeName = archiveName.slice('package/'.length);
    const components = relativeName.split('/');
    if (
      !relativeName ||
      components.some((component) => !component || component === '.' || component === '..' || component.includes('\\'))
    ) {
      throw new ZeroUpdateError(
        `[zero update] Packed framework contains an unsafe archive path: ${archiveName}`
      );
    }
    if (components[0] === 'node_modules') {
      throw new ZeroUpdateError(
        `[zero update] Packed framework contains a package-manager-owned path: ${archiveName}`
      );
    }
    expected.set(relativeName, file);
  }
  if (expected.size === 0) {
    throw new ZeroUpdateError('[zero update] Packed framework archive contains no package files');
  }

  const actualPaths = await listInstalledPackageFiles(installedRoot, projectDir);
  const expectedPaths = [...expected.keys()].sort();
  if (!isDeepStrictEqual(actualPaths, expectedPaths)) {
    throw new ZeroUpdateError(
      '[zero update] Installed framework file set does not match the packed local framework'
    );
  }

  for (const relativeName of expectedPaths) {
    const target = join(installedRoot, ...relativeName.split('/'));
    await assertSafeManagedParent(projectDir, target);
    const [actualBytes, expectedBytes] = await Promise.all([
      readFile(target),
      expected.get(relativeName)!.arrayBuffer().then((value) => Buffer.from(value)),
    ]);
    if (!actualBytes.equals(expectedBytes)) {
      throw new ZeroUpdateError(
        `[zero update] Installed framework content is stale or incomplete: ${relativeName}`
      );
    }
  }
}

async function listInstalledPackageFiles(
  installedRoot: string,
  projectDir: string
): Promise<string[]> {
  await assertSafeManagedParent(projectDir, join(installedRoot, 'package.json'));
  const rootInfo = await safeLstat(installedRoot);
  if (!rootInfo || rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
    throw new ZeroUpdateError(
      `[zero update] Installed framework is not a regular package directory: ${installedRoot}`
    );
  }

  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    await assertSafeManagedParent(projectDir, join(directory, '.entry'));
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (directory === installedRoot && entry.name === 'node_modules') {
        if (entry.isSymbolicLink() || !entry.isDirectory()) {
          throw new ZeroUpdateError(
            `[zero update] Invalid package-manager dependency directory: ${path}`
          );
        }
        continue;
      }
      if (entry.isSymbolicLink()) {
        throw new ZeroUpdateError(
          `[zero update] Refusing symlink inside installed framework package: ${path}`
        );
      }
      if (entry.isDirectory()) {
        await visit(path);
        continue;
      }
      if (!entry.isFile()) {
        throw new ZeroUpdateError(
          `[zero update] Refusing non-file entry inside installed framework package: ${path}`
        );
      }
      files.push(relative(installedRoot, path).split(sep).join('/'));
    }
  };

  await visit(installedRoot);
  return files.sort();
}

function buildUpdateCommand(mode: ZeroUpdateMode, latest: boolean): string[] {
  const command = ['bun', 'update', FRAMEWORK_PACKAGE];
  if (mode === 'local') command.push('--force', '--no-cache');
  if (latest) command.push('--latest');
  command.push('--ignore-scripts', '--no-progress');
  return command;
}

function availableSafeChecks(packageJson: PackageJson): Array<'typecheck' | 'doctor'> {
  const scripts = packageJson.scripts;
  if (!scripts || typeof scripts !== 'object') return [];
  return (['typecheck', 'doctor'] as const).filter((name) => typeof scripts[name] === 'string');
}

async function atomicallyReplaceFile(
  source: string,
  destination: string,
  projectDir: string
): Promise<void> {
  await assertSafeManagedParent(projectDir, destination);
  const temporary = join(projectDir, `.zero-update-file-${randomUUID()}.tmp`);
  try {
    await assertSafeManagedParent(projectDir, temporary);
    await copyFile(source, temporary);
    await assertSafeManagedParent(projectDir, destination);
    await rename(temporary, destination);
  } finally {
    await assertSafeManagedParent(projectDir, temporary)
      .then(() => rm(temporary, { force: true }))
      .catch(() => undefined);
  }
}

async function atomicallyWriteFile(
  contents: Uint8Array,
  destination: string,
  projectDir: string
): Promise<void> {
  await assertSafeManagedParent(projectDir, destination);
  const temporary = join(projectDir, `.zero-update-file-${randomUUID()}.tmp`);
  try {
    await assertSafeManagedParent(projectDir, temporary);
    await writeFile(temporary, contents);
    await assertSafeManagedParent(projectDir, destination);
    await rename(temporary, destination);
  } finally {
    await assertSafeManagedParent(projectDir, temporary)
      .then(() => rm(temporary, { force: true }))
      .catch(() => undefined);
  }
}

async function stageLocalArchiveResolution(
  state: ProjectState
): Promise<LocalArchiveResolutionSession> {
  const lockPath = state.lockPaths[0];
  if (!state.archivePath || basename(lockPath) !== 'bun.lock') {
    throw new Error('[zero update] Managed local archive lock state is unavailable');
  }
  const reference = createLocalArchiveResolutionReference(randomUUID());
  const stagedArchivePath = join(
    state.projectDir,
    ...reference.archiveRelativePath.replace(/^\.\//, '').split('/')
  );
  const stagedManifest = createStagedPackageManifest(
    state.packageJson,
    state.dependency.section,
    reference
  );

  try {
    await atomicallyReplaceFile(state.archivePath, stagedArchivePath, state.projectDir);
    await atomicallyWriteFile(
      new TextEncoder().encode(stagedManifest),
      state.packagePath,
      state.projectDir
    );
    return { reference, stagedArchivePath };
  } catch (error) {
    await assertSafeManagedParent(state.projectDir, stagedArchivePath)
      .then(() => rm(stagedArchivePath, { force: true }))
      .catch(() => undefined);
    throw error;
  }
}

async function finalizeLocalArchiveResolution(
  state: ProjectState,
  session: LocalArchiveResolutionSession
): Promise<string> {
  const lockPath = state.lockPaths[0];
  if (!state.archivePath || basename(lockPath) !== 'bun.lock') {
    throw new Error('[zero update] Managed local archive lock state is unavailable');
  }
  await assertRegularNonSymlinkFile(lockPath, 'bun.lock');
  await assertRegularNonSymlinkFile(state.packagePath, 'project package.json');
  await assertLocalManagedPath(state.projectDir, state.archivePath);
  const [lockText, archiveBytes, currentPackageBytes] = await Promise.all([
    readFile(lockPath, 'utf8'),
    readFile(state.archivePath),
    readFile(state.packagePath),
  ]);
  const currentPackage = parsePackageJson(currentPackageBytes, state.packagePath);
  const currentDependency = findFrameworkDependency(currentPackage);
  if (
    currentDependency.section !== state.dependency.section ||
    currentDependency.specifier !== session.reference.dependencySpecifier
  ) {
    throw new Error('[zero update] Bun changed the staged local framework dependency');
  }
  const expectedStagedManifest = JSON.parse(createStagedPackageManifest(
    state.packageJson, state.dependency.section, session.reference
  ));
  if (!isDeepStrictEqual(expectedStagedManifest, currentPackage)) {
    throw new Error('[zero update] package.json changed outside the staged framework dependency and matching override; refusing the update');
  }
  const updated = canonicalizeResolvedLocalArchiveLock(
    lockText,
    session.reference,
    archiveBytes
  );
  await atomicallyWriteFile(state.packageBytes, state.packagePath, state.projectDir);
  await atomicallyWriteFile(new TextEncoder().encode(updated), lockPath, state.projectDir);
  await removeStagedLocalArchive(state.projectDir, session);
  return updated;
}

async function assertCanonicalInstallPreservedLock(
  state: ProjectState,
  expectedLockText: string
): Promise<void> {
  const lockPath = state.lockPaths[0];
  await assertRegularNonSymlinkFile(lockPath, 'bun.lock');
  if (await readFile(lockPath, 'utf8') !== expectedLockText) {
    throw new Error(
      '[zero update] Bun changed bun.lock while installing the canonical local archive'
    );
  }
}

async function restoreLocalPackageManifestFormatting(state: ProjectState): Promise<void> {
  await assertRegularNonSymlinkFile(state.packagePath, 'project package.json');
  const currentBytes = await readFile(state.packagePath);
  if (!isDeepStrictEqual(parsePackageJson(currentBytes, state.packagePath), state.packageJson)) {
    throw new Error('[zero update] Canonical installation changed package.json outside formatting; refusing the update');
  }
  // Bun may reformat the manifest during its canonical install. Restore only
  // after proving every original declaration (including overrides) is intact.
  if (!currentBytes.equals(state.packageBytes)) {
    await atomicallyWriteFile(state.packageBytes, state.packagePath, state.projectDir);
  }
}

async function removeStagedLocalArchive(
  projectDir: string,
  session: LocalArchiveResolutionSession
): Promise<void> {
  await assertSafeManagedParent(projectDir, session.stagedArchivePath);
  await rm(session.stagedArchivePath, { force: true });
}

async function assertLocalArchiveLock(state: ProjectState): Promise<void> {
  const lockPath = state.lockPaths[0];
  if (!state.archivePath || basename(lockPath) !== 'bun.lock') {
    throw new Error('[zero update] Managed local archive lock state is unavailable');
  }
  await assertRegularNonSymlinkFile(lockPath, 'bun.lock');
  await assertLocalManagedPath(state.projectDir, state.archivePath);
  const [lockText, archiveBytes] = await Promise.all([
    readFile(lockPath, 'utf8'),
    readFile(state.archivePath),
  ]);
  if (bindBunLockToLocalArchive(lockText, archiveBytes) !== lockText) {
    throw new Error('[zero update] bun.lock integrity does not match the managed local archive');
  }
}

async function rollbackProject(
  state: ProjectState,
  snapshot: UpdateSnapshot,
  runner: NonNullable<ZeroUpdateDependencies['runCommand']>
): Promise<{ succeeded: boolean; error?: string }> {
  try {
    await restoreSnapshotFiles(snapshot.files, state.projectDir);
    if (didManagedArchiveExist(state, snapshot)) {
      // A frozen install can reuse the replacement archive's extracted cache
      // even after restoring the original lock/integrity. A targeted frozen
      // update rebinds only the restored local framework archive through Bun,
      // without touching cache internals or re-resolving the app's lock.
      const command = state.archivePath
        ? ['bun', 'update', FRAMEWORK_PACKAGE]
        : ['bun', 'install'];
      command.push(
        '--frozen-lockfile',
        '--force',
        '--no-cache',
        '--ignore-scripts',
        '--no-progress',
      );
      const result = await runner(command, { cwd: state.projectDir, stdio: 'inherit' });
      if (result.exitCode !== 0) {
        throw new Error(commandFailureMessage('rollback installation', command, result));
      }
    }
    await restoreInstalledFrameworkState(state, snapshot);
    await restoreSnapshotFiles(snapshot.files, state.projectDir);
    await restoreManagedDirectories(snapshot.managedDirectories, state.projectDir);
    await assertRestoredInstalledFramework(state);
    return { succeeded: true };
  } catch (error) {
    let fallbackError: unknown = null;
    try {
      await restoreSnapshotFiles(snapshot.files, state.projectDir);
      await restoreInstalledFrameworkState(state, snapshot);
      await restoreSnapshotFiles(snapshot.files, state.projectDir);
      await restoreManagedDirectories(snapshot.managedDirectories, state.projectDir);
      await assertRestoredInstalledFramework(state);
    } catch (innerError) {
      fallbackError = innerError;
    }
    const original = error instanceof Error ? error.message : String(error);
    const fallback = fallbackError
      ? `; direct installed-package fallback also failed: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`
      : '';
    return { succeeded: false, error: `${original}${fallback}` };
  }
}

function didManagedArchiveExist(state: ProjectState, snapshot: UpdateSnapshot): boolean {
  if (!state.archivePath) return true;
  return snapshot.files.find((file) => file.path === state.archivePath)?.existed ?? false;
}

async function restoreInstalledFrameworkState(
  state: ProjectState,
  snapshot: UpdateSnapshot
): Promise<void> {
  if (snapshot.installedFrameworkBackup) {
    await restoreInstalledFramework(state.projectDir, snapshot.installedFrameworkBackup);
    return;
  }
  if (snapshot.installedFrameworkExisted) {
    throw new Error('[zero update] Installed framework backup is unexpectedly missing');
  }
  const target = join(state.projectDir, 'node_modules', '@zero', 'framework');
  await assertSafeManagedParent(state.projectDir, target);
  await rm(target, { recursive: true, force: true });
}

async function assertRestoredInstalledFramework(state: ProjectState): Promise<void> {
  const restoredVersion = await readInstalledFrameworkVersion(state.projectDir, false);
  if (restoredVersion !== state.installedVersion) {
    throw new Error(
      `[zero update] Rollback installed framework mismatch: expected ${state.installedVersion ?? 'absent'}, found ${restoredVersion ?? 'absent'}`
    );
  }
}

async function restoreSnapshotFiles(files: FileSnapshot[], projectDir: string): Promise<void> {
  for (const file of files) {
    await assertSafeManagedParent(projectDir, file.path);
    if (!file.existed) {
      await rm(file.path, { force: true });
      if (await safeLstat(file.path)) {
        throw new Error(`[zero update] Rollback did not restore absence of ${basename(file.path)}`);
      }
      continue;
    }
    await atomicallyReplaceFile(file.backupPath, file.path, projectDir);
    await assertSafeManagedParent(projectDir, file.path);
    await assertRegularNonSymlinkFile(file.path, `restored ${basename(file.path)}`);
    if (!Bun.deepEquals(await Bun.file(file.path).bytes(), await Bun.file(file.backupPath).bytes())) {
      throw new Error(`[zero update] Rollback did not restore exact bytes of ${basename(file.path)}`);
    }
  }
}

async function restoreManagedDirectories(
  directories: DirectorySnapshot[],
  projectDir: string
): Promise<void> {
  for (const directory of directories) {
    if (directory.existed) await ensureManagedDirectory(projectDir, directory.path);
  }

  for (const directory of [...directories].reverse()) {
    if (directory.existed) continue;
    await assertSafeManagedParent(projectDir, directory.path);
    const current = await safeLstat(directory.path);
    if (!current) continue;
    if (current.isSymbolicLink() || !current.isDirectory()) {
      throw new ZeroUpdateError(
        `[zero update] Refusing to remove changed managed directory during rollback: ${directory.path}`
      );
    }
    try {
      await rmdir(directory.path);
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') continue;
      throw error;
    }
  }
}

async function restoreInstalledFramework(projectDir: string, backup: string): Promise<void> {
  const parent = join(projectDir, 'node_modules', '@zero');
  const target = join(parent, 'framework');
  await assertSafeManagedParent(projectDir, target);
  await mkdir(parent, { recursive: true });
  await assertSafeManagedParent(projectDir, target);
  const staged = join(projectDir, `.zero-update-framework-restore-${randomUUID()}`);
  const displaced = join(projectDir, `.zero-update-framework-displaced-${randomUUID()}`);
  await assertSafeManagedParent(projectDir, staged);
  await cp(backup, staged, { recursive: true, force: true, dereference: false });
  let displacedExisting = false;
  try {
    await assertSafeManagedParent(projectDir, target);
    if (await pathExists(target)) {
      await rename(target, displaced);
      displacedExisting = true;
    }
    await assertSafeManagedParent(projectDir, target);
    await rename(staged, target);
    if (displacedExisting) {
      await assertSafeManagedParent(projectDir, displaced);
      await rm(displaced, { recursive: true, force: true });
    }
  } catch (error) {
    await assertSafeManagedParent(projectDir, staged)
      .then(() => rm(staged, { recursive: true, force: true }))
      .catch(() => undefined);
    if (displacedExisting) {
      await assertSafeManagedParent(projectDir, target);
      if (!(await pathExists(target))) {
        await assertSafeManagedParent(projectDir, displaced);
        await rename(displaced, target);
      }
    }
    throw error;
  }
}

/**
 * Revalidate every existing parent immediately before a managed write.
 *
 * Initial inspection is not enough: a failed package-manager process could
 * replace a managed directory with a symlink before rollback starts. Refusing
 * that new boundary is safer than following it and overwriting an unrelated
 * file outside the project.
 */
async function assertSafeManagedParent(projectDir: string, targetPath: string): Promise<void> {
  const root = resolve(projectDir);
  const target = resolve(targetPath);
  assertWithinProject(root, target);

  const rootInfo = await safeLstat(root);
  if (!rootInfo || rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
    throw new ZeroUpdateError(`[zero update] Project boundary changed during update: ${root}`);
  }

  const components = relative(root, target).split(sep).filter(Boolean);
  let current = root;
  for (const component of components.slice(0, -1)) {
    current = join(current, component);
    const info = await safeLstat(current);
    if (!info) return;
    if (info.isSymbolicLink()) {
      throw new ZeroUpdateError(`[zero update] Refusing symlinked managed-path parent: ${current}`);
    }
    if (!info.isDirectory()) {
      throw new ZeroUpdateError(`[zero update] Managed-path parent is not a directory: ${current}`);
    }
  }
}

async function sha256File(path: string): Promise<string> {
  const bytes = await readFile(path);
  return createHash('sha256').update(bytes).digest('hex');
}

async function safeLstat(path: string): Promise<Awaited<ReturnType<typeof lstat>> | null> {
  try {
    return await lstat(path);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return null;
    throw error;
  }
}

async function pathExists(path: string): Promise<boolean> {
  return (await safeLstat(path)) !== null;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

async function runCommand(argv: string[], options: UpdateCommandOptions): Promise<UpdateCommandResult> {
  const child = Bun.spawn(argv, {
    cwd: options.cwd,
    stdin: options.stdio === 'inherit' ? 'inherit' : 'ignore',
    stdout: options.stdio,
    stderr: options.stdio,
    env: Bun.env,
  });
  if (options.stdio === 'inherit') return { exitCode: await child.exited };
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, stdout, stderr };
}

function commandFailureMessage(
  phase: string,
  command: string[],
  result: UpdateCommandResult
): string {
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  return `[zero update] ${phase} failed (exit ${result.exitCode}): ${command.join(' ')}${output ? `\n${output}` : ''}`;
}

function asUpdateError(error: unknown): ZeroUpdateError {
  if (error instanceof ZeroUpdateError) return error;
  return new ZeroUpdateError(error instanceof Error ? error.message : String(error), { cause: error });
}

function printResult(
  result: ZeroUpdateResult,
  logger: Pick<Console, 'log'>,
  checksRequested: boolean
): void {
  logger.log('');
  logger.log(result.dryRun ? 'Zero update plan' : 'Zero update complete');
  logger.log('--------------------');
  logger.log(`Project:    ${result.projectDir}`);
  logger.log(`Mode:       ${result.mode}`);
  logger.log(`Dependency: ${result.dependencyBefore} -> ${result.dependencyAfter}`);
  if (result.versionBefore || result.versionAfter) {
    logger.log(`Version:    ${result.versionBefore ?? 'unknown'} -> ${result.versionAfter ?? 'unknown'}`);
  }
  if (result.mode === 'local') {
    logger.log(
      `Archive:    ${abbreviateHash(result.archiveHashBefore)} -> ${abbreviateHash(result.archiveHashAfter)}`
    );
  }
  if (!result.dryRun) logger.log(`Changed:    ${result.changed ? 'yes' : 'no (framework was reinstalled)'}`);
  if (result.dryRun && checksRequested) {
    logger.log('Checks:     not run during dry-run');
  } else if (checksRequested) {
    logger.log(`Checks:     ${result.checks.length ? result.checks.map((entry) => entry.script).join(', ') : 'none available'}`);
  } else if (!result.dryRun) {
    logger.log('Checks:     skipped (use --check to opt in to typecheck and doctor)');
  }
  if (!result.dryRun) {
    logger.log('Migration:  Zero did not directly invoke migration tooling');
  }
  logger.log('');
}

function abbreviateHash(hash: string | null): string {
  return hash ? hash.slice(0, 12) : 'pending';
}

function printUsage(logger: Pick<Console, 'log'>): void {
  logger.log(
    'Usage: zero update [--project <dir>] [--local <framework-dir> | --latest] [--dry-run] [--check]'
  );
  logger.log('');
  logger.log('Modes:');
  logger.log('  zero update                         Update within the declared registry range');
  logger.log('  zero update --latest                Update to the latest registry release');
  logger.log('  zero update --local /path/to/zero   Replace the managed local framework archive');
  logger.log('');
  logger.log('Requires one Bun lockfile; local archive updates require text bun.lock (including dry-run).');
  logger.log(`--local only accepts projects already using ${LOCAL_FRAMEWORK_DEPENDENCY}.`);
  logger.log(
    'A mutating local update creates a missing managed .zero/framework cache; dry-run never creates it.'
  );
  logger.log(
    'Safety: updater writes are limited to @zero/framework dependency/install state, Bun lock files, and the managed local archive.'
  );
  logger.log('No app scripts run by default; Zero never directly selects a migration command.');
  logger.log(
    '--check explicitly runs project-owned typecheck/doctor scripts; their own side effects are outside updater rollback.'
  );
}

if (import.meta.main) {
  process.exitCode = await runZeroUpdateCli();
}
