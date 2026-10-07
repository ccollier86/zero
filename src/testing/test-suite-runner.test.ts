/** Real synthetic Bun subprocesses qualify isolation, honest failure/timeout reporting and owned interruption cleanup. */
import { expect, test } from 'bun:test';
import { chmod, mkdir, mkdtemp, rm } from 'node:fs/promises'; // Bun has no directory or chmod API.
import { join } from 'node:path';
import { runTestSuite, type TestSuiteEvent, type TestSuiteSummary } from './test-suite-runner';
import { drainTestSuiteOutput } from './test-suite-output';
import { FRAMEWORK_INSTALLED_CONSUMER_FILES, isFrameworkInstalledConsumer } from './test-suite-resources';

const runner = join(import.meta.dir, 'run-test-suite.ts');
const pass = `import {test,expect} from 'bun:test'; test('pass',()=>expect(true).toBe(true));`;
async function scratch() {
  const directory = '/Volumes/code-bank/tmp/scratch/zero-platform'; await mkdir(directory, { recursive: true });
  return mkdtemp(join(directory, 'suite-process-'));
}
function exists(pid: number) { try { process.kill(pid, 0); return true; } catch { return false; } }
async function wait(predicate: () => boolean, deadlineMs = 5000) {
  const end = performance.now() + deadlineMs;
  while (!predicate()) { if (performance.now() > end) throw new Error('Synthetic subprocess deadline exceeded.'); await Bun.sleep(10); }
}
async function cli(root: string, args: string[] = []) {
  const child = Bun.spawn([process.execPath, '--no-env-file', '--no-orphans', runner, ...args], {
    cwd: root, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  return { code, stderr, events: stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) as TestSuiteEvent[] };
}

test('four real child processes run every selected file exactly once with independent global state', async () => {
  const root = await scratch();
  try {
    const files = Array.from({ length: 6 }, (_, index) => `${index}.test.ts`), pids = new Set<number>();
    for (const file of files) await Bun.write(join(root, file), `import {test,expect} from 'bun:test';
      console.log('SYNTHETIC_PID',process.pid);test('fresh global',async()=>{expect(globalThis.__suiteLeak).toBeUndefined();
      globalThis.__suiteLeak=true;await Bun.sleep(100);});`);
    let active = 0, peak = 0;
    const started: string[] = [];
    const summary = await runTestSuite({ root, files, fileTimeoutMs: 5000,
      event(event) {
        if (event.type === 'test-file-start') { started.push(event.file); peak = Math.max(peak, ++active); }
        if (event.type === 'test-file-result') active--;
      },
      output(_file, _channel, text) { for (const match of text.matchAll(/SYNTHETIC_PID (\d+)/g)) pids.add(Number(match[1])); },
    });
    expect(summary).toMatchObject({ total: 6, passed: 6, failed: 0, notRun: 0, exitCode: 0 });
    expect(started).toEqual(files); expect(pids.size).toBe(6); expect(peak).toBe(4); expect(active).toBe(0);
    expect([...pids].some(exists)).toBe(false);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 20000);

test('full-framework installed consumers share one slot without blocking three ordinary child processes', async () => {
  const root = await scratch();
  try {
    const files = [...FRAMEWORK_INSTALLED_CONSUMER_FILES.slice(1, 4), 'zz/0.test.ts', 'zz/1.test.ts', 'zz/2.test.ts'];
    for (const file of files) {
      await mkdir(join(root, file, '..'), { recursive: true });
      await Bun.write(join(root, file), `import {test,expect} from 'bun:test';
        test('resource admission',async()=>{await Bun.sleep(150);expect(true).toBe(true);});`);
    }
    let active = 0, peak = 0, installed = 0, installedPeak = 0, firstInstalledSettled = false;
    const started: string[] = [], ordinaryBeforeInstalledSettled: string[] = [];
    const summary = await runTestSuite({ root, files, fileTimeoutMs: 5000,
      event(event) {
        if (event.type === 'test-file-start') {
          started.push(event.file); peak = Math.max(peak, ++active);
          if (isFrameworkInstalledConsumer(event.file)) installedPeak = Math.max(installedPeak, ++installed);
          else if (!firstInstalledSettled) ordinaryBeforeInstalledSettled.push(event.file);
        }
        if (event.type === 'test-file-result') {
          active--;
          if (isFrameworkInstalledConsumer(event.file)) { installed--; firstInstalledSettled = true; }
        }
      },
    });
    expect(summary).toMatchObject({ total: 6, passed: 6, failed: 0, notRun: 0, exitCode: 0 });
    expect(new Set(started).size).toBe(6); expect([...started].sort()).toEqual([...files].sort());
    expect(installedPeak).toBe(1); expect(peak).toBe(4); expect(active).toBe(0); expect(installed).toBe(0);
    expect(ordinaryBeforeInstalledSettled).toEqual(['zz/0.test.ts', 'zz/1.test.ts', 'zz/2.test.ts']);
    expect(summary.results.map(result => result.file)).toEqual([...files].sort());
  } finally { await rm(root, { recursive: true, force: true }); }
}, 15000);

test('an installed-consumer failure releases admission without retrying or omitting its successor', async () => {
  const root = await scratch();
  try {
    const files = [...FRAMEWORK_INSTALLED_CONSUMER_FILES.slice(1, 3)];
    for (const [index, file] of files.entries()) {
      await mkdir(join(root, file, '..'), { recursive: true });
      await Bun.write(join(root, file), index === 0 ? `console.log('RESOURCE_FAILURE');process.exit(17);` : pass);
    }
    const started: string[] = []; let output = '';
    const summary = await runTestSuite({ root, files, fileTimeoutMs: 5000,
      event(event) { if (event.type === 'test-file-start') started.push(event.file); },
      output(_file, _channel, text) { output += text; },
    });
    expect(summary).toMatchObject({ total: 2, passed: 1, failed: 1, notRun: 0, exitCode: 17 });
    expect(started).toEqual(files); expect(output.match(/RESOURCE_FAILURE/g)).toHaveLength(1);
    expect(summary.results.map(result => result.status)).toEqual(['failed', 'passed']);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 10000);

test('interruption retires active class and ordinary children and never admits blocked consumers', async () => {
  const root = await scratch();
  try {
    const files = [...FRAMEWORK_INSTALLED_CONSUMER_FILES.slice(1, 4), 'zz/0.test.ts', 'zz/1.test.ts', 'zz/2.test.ts'];
    for (const file of files) {
      await mkdir(join(root, file, '..'), { recursive: true });
      await Bun.write(join(root, file), `import {test} from 'bun:test';console.log('RESOURCE_PID',process.pid);
        test('held',async()=>await Bun.sleep(999999));`);
    }
    const controller = new AbortController(), pids = new Set<number>(), started: string[] = [];
    const summary = await runTestSuite({ root, files, fileTimeoutMs: 5000, signal: controller.signal,
      event(event) { if (event.type === 'test-file-start') started.push(event.file); },
      output(_file, _channel, text) {
        for (const match of text.matchAll(/RESOURCE_PID (\d+)/g)) pids.add(Number(match[1]));
        if (pids.size === 4) controller.abort('SIGTERM');
      },
    });
    expect(summary).toMatchObject({ total: 6, passed: 0, failed: 4, notRun: 2, interrupted: 'SIGTERM', exitCode: 143 });
    expect(started.filter(isFrameworkInstalledConsumer)).toEqual([files[0]!]);
    expect(started).toHaveLength(4); expect(pids.size).toBe(4); expect([...pids].some(exists)).toBe(false);
    expect(summary.results.filter(result => result.status === 'cancelled')).toHaveLength(4);
    expect(summary.results.filter(result => result.status === 'not-run').map(result => result.file)).toEqual(files.slice(1, 3));
  } finally { await rm(root, { recursive: true, force: true }); }
}, 15000);

test('failures and native signals are not retried, hidden, or converted to pass', async () => {
  const root = await scratch();
  try {
    await Bun.write(join(root, 'a-fail.test.ts'), `console.log('ATTEMPT_FAIL');process.exit(17);`);
    await Bun.write(join(root, 'b-signal.test.ts'), `console.log('ATTEMPT_SIGNAL');process.kill(process.pid,'SIGKILL');`);
    await Bun.write(join(root, 'c-pass.test.ts'), pass);
    let output = '';
    const summary = await runTestSuite({ root, files: ['c-pass.test.ts', 'a-fail.test.ts', 'b-signal.test.ts'], fileTimeoutMs: 5000,
      output(_file, _channel, text) { output += text; } });
    expect(summary).toMatchObject({ total: 3, passed: 1, failed: 2, notRun: 0, exitCode: 17 });
    expect(summary.results.map(result => [result.file, result.status, result.exitCode, result.signal]))
      .toEqual([['a-fail.test.ts', 'failed', 17, null], ['b-signal.test.ts', 'signal', 137, 'SIGKILL'], ['c-pass.test.ts', 'passed', 0, null]]);
    expect(output.match(/ATTEMPT_FAIL/g)?.length).toBe(1); expect(output.match(/ATTEMPT_SIGNAL/g)?.length).toBe(1);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 20000);

test('per-file process deadline stops a held test and is never an optimistic success', async () => {
  const root = await scratch();
  try {
    await Bun.write(join(root, 'held.test.ts'), `import {test} from 'bun:test';process.on('SIGTERM',()=>{});
      test('held',async()=>{await Bun.sleep(999999);});`);
    const summary = await runTestSuite({ root, files: ['held.test.ts'], fileTimeoutMs: 400 });
    expect(summary).toMatchObject({ total: 1, passed: 0, failed: 1, notRun: 0, exitCode: 124 });
    expect(summary.results[0]?.status).toBe('timeout'); expect(summary.durationMs).toBeLessThan(4000);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 10000);

test('a normal zero exit with leaked owned descendants is retired and reported as failure', async () => {
  const root = await scratch();
  try {
    const wrapper = join(root, 'bun-without-orphan-flag');
    // Remove the backup flag only in this synthetic probe, so real group retirement is independently exercised.
    await Bun.write(wrapper, `#!/bin/sh\nshift 2\nexec ${JSON.stringify(process.execPath)} "$@"\n`); await chmod(wrapper, 0o700);
    const descendant = join(root, 'descendant.ts'); await Bun.write(descendant, 'setInterval(()=>{},1000);');
    await Bun.write(join(root, 'leak.test.ts'), `const child=Bun.spawn([process.execPath,${JSON.stringify(descendant)}],
      {stdin:'ignore',stdout:'ignore',stderr:'ignore'});child.unref();console.log('LEAK_PID',child.pid);process.exit(0);`);
    let output = '';
    const summary = await runTestSuite({ root, files: ['leak.test.ts'], fileTimeoutMs: 5000, bunExecutable: wrapper,
      output(_file, _channel, text) { output += text; } });
    expect(summary).toMatchObject({ total: 1, passed: 0, failed: 1, notRun: 0, exitCode: 1 });
    expect(summary.results[0]).toMatchObject({ status: 'leaked-processes', exitCode: 0, leakedDescendants: true, cleanupIncomplete: false });
    const pid = Number(output.match(/LEAK_PID (\d+)/)?.[1]); expect(pid).toBeGreaterThan(1); expect(exists(pid)).toBe(false);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 10000);

test('canonical CLI forwards per-test timeout and preserves explicit shorter test deadlines', async () => {
  const root = await scratch();
  try {
    await Bun.write(join(root, 'default.test.ts'), `import {test,expect} from 'bun:test';test('longer than override',async()=>{
      await Bun.sleep(80);expect(true).toBe(true);});`);
    const rejected = await cli(root, ['--timeout', '20', '--file-timeout', '3000']);
    expect(rejected.code).not.toBe(0);
    await Bun.write(join(root, 'default.test.ts'), `import {test,expect} from 'bun:test';test('own short deadline',async()=>{
      await Bun.sleep(80);expect(true).toBe(true);},20);`);
    const explicit = await cli(root, ['--timeout=120000', '--file-timeout=3000']);
    expect(explicit.code).not.toBe(0);
    expect(explicit.events.at(-1)).toMatchObject({ type: 'test-suite-summary', failed: 1, passed: 0 });
    const invalid = await cli(root, ['--parallel=4']); expect(invalid.code).toBe(2); expect(invalid.stderr).toContain('Unsupported');
  } finally { await rm(root, { recursive: true, force: true }); }
}, 20000);

test('explicit full-inventory execution does not lose files to bunfig feature ignores', async () => {
  const root = await scratch();
  try {
    await Bun.write(join(root, 'bunfig.toml'), '[test]\npathIgnorePatterns = ["omit.test.ts"]\n');
    await Bun.write(join(root, 'omit.test.ts'), `console.log('ADMITTED_IGNORED_FILE');${pass}`);
    await mkdir(join(root, '__zero_full_inventory__'));
    await Bun.write(join(root, '__zero_full_inventory__/inside.test.ts'), `console.log('ADMITTED_NAMED_DIRECTORY');${pass}`);
    const result = await cli(root); expect(result.code).toBe(0); expect(result.stderr).toContain('ADMITTED_IGNORED_FILE');
    expect(result.stderr).toContain('ADMITTED_NAMED_DIRECTORY');
    expect(result.events.at(-1)).toMatchObject({ total: 2, passed: 2, failed: 0 });
  } finally { await rm(root, { recursive: true, force: true }); }
}, 10000);

test('post-exit output inherited by a separate group is bounded and reported, not killed as an unrelated group', async () => {
  const root = await scratch(); let pid = 0;
  try {
    const wrapper = join(root, 'without-backup');
    await Bun.write(wrapper, `#!/bin/sh\nshift 2\nexec ${JSON.stringify(process.execPath)} "$@"\n`); await chmod(wrapper, 0o700);
    const escaped = join(root, 'escaped.ts'); await Bun.write(escaped, 'setInterval(()=>{},1000);');
    await Bun.write(join(root, 'output.test.ts'), `const child=Bun.spawn([process.execPath,${JSON.stringify(escaped)}],
      {detached:true,stdin:'ignore',stdout:'inherit',stderr:'ignore'});child.unref();console.log('ESCAPED_PID',child.pid);process.exit(0);`);
    let output = '';
    const summary = await runTestSuite({ root, files: ['output.test.ts'], fileTimeoutMs: 5000, bunExecutable: wrapper,
      output(_file, _channel, text) { output += text; pid = Number(output.match(/ESCAPED_PID (\d+)/)?.[1] ?? 0); } });
    expect(summary).toMatchObject({ passed: 0, failed: 1, exitCode: 1 });
    expect(summary.results[0]).toMatchObject({ status: 'failed', exitCode: 0, outputIncomplete: true });
    expect(summary.results[0]?.outputDiagnostics).toMatchObject({
      stdout: { eof: false, pending: 'read' }, stderr: { eof: true, pending: null },
    });
    expect(summary.durationMs).toBeLessThan(4000); expect(pid).toBeGreaterThan(1);
    expect(exists(pid)).toBe(true); // The runner never owns or signals this deliberately different group.
  } finally {
    if (pid > 1 && exists(pid)) process.kill(pid, 'SIGKILL');
    await rm(root, { recursive: true, force: true });
  }
}, 10000);

test('output callback rejection retires its child and settles the other pipe boundedly', async () => {
  const root = await scratch();
  try {
    await Bun.write(join(root, 'sink.test.ts'), `import {test} from 'bun:test';console.log('SYNTHETIC_SINK');
      test('held',async()=>await Bun.sleep(999999));`);
    const summary = await runTestSuite({ root, files: ['sink.test.ts'], fileTimeoutMs: 5000,
      output(_file, _channel, text) { if (text.includes('SYNTHETIC_SINK')) throw new Error('Synthetic output sink rejected.'); } });
    expect(summary).toMatchObject({ passed: 0, failed: 1 }); expect(summary.exitCode).not.toBe(0);
    expect(summary.results[0]).toMatchObject({ status: 'failed', error: 'Synthetic output sink rejected.' });
    expect(summary.durationMs).toBeLessThan(4000);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 10000);

test('root SIGTERM retires admitted children and descendants, does not admit queued files, and exits nonzero', async () => {
  const root = await scratch();
  let child: Bun.Subprocess<'ignore', 'pipe', 'pipe'> | undefined;
  try {
    const descendant = join(root, 'descendant.ts'); await Bun.write(descendant, 'setInterval(()=>{},1000);');
    for (let index = 0; index < 6; index++) await Bun.write(join(root, `${index}.test.ts`), `import {test} from 'bun:test';
      const descendant=Bun.spawn([process.execPath,${JSON.stringify(descendant)}],{stdin:'ignore',stdout:'ignore',stderr:'ignore'});
      console.log('SYNTHETIC_OWNED',process.pid,descendant.pid);test('held',async()=>await Bun.sleep(999999));`);
    child = Bun.spawn([process.execPath, '--no-env-file', '--no-orphans', runner, '--file-timeout=5000'], {
      cwd: root, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
    let raw = '', stderr = '';
    const drain = async (stream: ReadableStream<Uint8Array>, collect: (text: string) => void) => {
      const reader = stream.getReader();
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          collect(new TextDecoder().decode(chunk.value));
        }
      } finally { reader.releaseLock(); }
    };
    const pipes = [drain(child.stdout, text => { raw += text; }), drain(child.stderr, text => { stderr += text; })];
    await wait(() => [...stderr.matchAll(/SYNTHETIC_OWNED (\d+) (\d+)/g)].length === 4);
    const owned = [...stderr.matchAll(/SYNTHETIC_OWNED (\d+) (\d+)/g)].flatMap(match => [Number(match[1]), Number(match[2])]);
    child.kill('SIGTERM');
    expect(await child.exited).toBe(143); await Promise.all(pipes);
    const summary = JSON.parse(raw.trim().split('\n').at(-1)!) as TestSuiteSummary;
    expect(summary).toMatchObject({ total: 6, passed: 0, notRun: 2, interrupted: 'SIGTERM', exitCode: 143 });
    expect(summary.results.filter(result => result.status === 'cancelled')).toHaveLength(4);
    await wait(() => owned.every(pid => !exists(pid)));
    expect(owned.some(exists)).toBe(false);
  } finally {
    if (child && child.exitCode === null) { child.kill('SIGKILL'); await child.exited; }
    await rm(root, { recursive: true, force: true });
  }
}, 20000);

test('incomplete output identifies a pending read, exact byte progress and cancellation without recording text', async () => {
  let cancelled = 0;
  const bytes = new TextEncoder().encode('private synthetic payload 🚀');
  const stdout = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(bytes); }, cancel() { cancelled++; },
  });
  const stderr = new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } });
  const drain = drainTestSuiteOutput({ stdout, stderr });
  const result = await drain.settle();
  expect(result).toMatchObject({ outputIncomplete: true, outputDiagnostics: {
    stdout: { bytesRead: bytes.byteLength, chunksRead: 1, eof: false, pending: 'read' },
    stderr: { bytesRead: 0, chunksRead: 0, eof: true, pending: null, pendingForMs: 0 },
  } });
  expect(result.outputDiagnostics!.stdout.pendingForMs).toBeGreaterThanOrEqual(900);
  expect(JSON.stringify(result)).not.toContain('private synthetic payload');
  expect(cancelled).toBe(1); drain.cancel(); expect(cancelled).toBe(1);
}, 5000);

test('incomplete output distinguishes a held consumer from a held pipe and cancels both boundedly', async () => {
  let cancelled = 0, calls = 0;
  const stdout = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array([65, 66])); }, cancel() { cancelled++; },
  });
  const stderr = new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } });
  const drain = drainTestSuiteOutput({ stdout, stderr }, () => { calls++; return new Promise<void>(() => {}); });
  const result = await drain.settle();
  expect(result).toMatchObject({ outputIncomplete: true, outputDiagnostics: {
    stdout: { bytesRead: 2, chunksRead: 1, eof: false, pending: 'sink' },
    stderr: { bytesRead: 0, chunksRead: 0, eof: true, pending: null },
  } });
  expect(result.outputDiagnostics!.stdout.pendingForMs).toBeGreaterThanOrEqual(900);
  expect(calls).toBe(1); expect(cancelled).toBe(1);
}, 5000);

test('an EOF decoder tail blocked by the consumer is not misreported as an open inherited pipe', async () => {
  const stdout = new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(new Uint8Array([0xf0, 0x9f])); controller.close();
  } });
  const stderr = new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } });
  const drain = drainTestSuiteOutput({ stdout, stderr }, () => new Promise<void>(() => {}));
  expect(await drain.settle()).toMatchObject({ outputIncomplete: true, outputDiagnostics: {
    stdout: { bytesRead: 2, chunksRead: 1, eof: true, pending: 'sink' },
    stderr: { eof: true, pending: null },
  } });
}, 5000);

test('completed output retains split UTF-8 and does not emit incomplete-channel diagnostics', async () => {
  const bytes = new TextEncoder().encode('🚀'); let output = '';
  const stdout = new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(bytes.slice(0, 2)); controller.enqueue(bytes.slice(2)); controller.close();
  } });
  const stderr = new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } });
  const result = await drainTestSuiteOutput({ stdout, stderr }, (_channel, text) => { output += text; }).settle();
  expect(result).toEqual({ outputIncomplete: false }); expect(output).toBe('🚀');
});
