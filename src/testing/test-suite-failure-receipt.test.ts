/** Real CLI faults retain payload-free evidence after owned worker cleanup even when its normal JSON sink is poisoned. */
import { expect, test } from 'bun:test';
import { mkdtemp, rm, stat } from 'node:fs/promises'; // Bun has no temp-directory/removal/directory-stat equivalent.
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestSuiteFailureReceipt } from './test-suite-failure-receipt';

const exists = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
test.each(['stderr', 'event', 'inventory'] as const)('real %s emission fault keeps a safe receipt and retires all captured children', async kind => {
  const root = await mkdtemp(join(tmpdir(), 'zero-suite-failure-fixture-'));
  const owned: number[] = [];
  let child: Bun.Subprocess<'ignore', 'pipe', 'pipe'> | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const descendant = join(root, 'descendant.ts'), fixture = join(root, 'cli.ts');
    await Bun.write(descendant, 'setInterval(()=>{},1000);');
    for (let index = 0; index < 4; index++) await Bun.write(join(root, `${index}.test.ts`), `import {test,expect} from 'bun:test';
      const descendant=${index}===0?null:Bun.spawn([process.execPath,'--no-env-file',${JSON.stringify(descendant)}],{stdin:'ignore',stdout:'ignore',stderr:'ignore'});
      console.log('SYNTHETIC_OWNED',process.pid,descendant?.pid??0);
      test('owned',async()=>{await Bun.sleep(${index === 0 ? 300 : 999999});expect(true).toBe(true);});`);
    await Bun.write(fixture, `import {runTestSuiteCli} from ${JSON.stringify(join(import.meta.dir, 'run-test-suite.ts'))};
      import {createTestSuiteConsoleWriter} from ${JSON.stringify(join(import.meta.dir, 'test-suite-console-writer.ts'))};
      const wrap=(channel)=>{const sink=(channel==='stdout'?Bun.stdout:Bun.stderr).writer();return {
        write(text){if((${JSON.stringify(kind)}==='stderr'&&channel==='stderr')||(${JSON.stringify(kind)}==='event'&&channel==='stdout'&&text.includes('"type":"test-file-result"'))
          ||(${JSON.stringify(kind)}==='inventory'&&channel==='stdout'&&text.includes('"type":"test-suite-inventory"')))
          throw Object.assign(new Error('PRIVATE_CAUSE_NOT_FOR_RECEIPT'),{code:'EPIPE'});return sink.write(text);},
        flush:()=>sink.flush(),end:()=>sink.end(),unref:()=>sink.unref()};};
      process.exitCode=await runTestSuiteCli(createTestSuiteConsoleWriter({stdout:wrap('stdout'),stderr:wrap('stderr')}),['--file-timeout=5000']);`);
    child = Bun.spawn([process.execPath, '--no-env-file', fixture], {
      cwd: root, env: { TMPDIR: root, PATH: '/usr/bin:/bin' }, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe',
    });
    timer = setTimeout(() => child!.kill('SIGKILL'), 10000);
    const [exit, stdout, stderr] = await Promise.all([child.exited,
      new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(exit).toBe(2); expect(child.signalCode).toBeNull();
    const inventory = stdout.split('\n').filter(Boolean).map(line => JSON.parse(line)).find(event => event.type === 'test-suite-inventory');
    const reports = [...new Bun.Glob('zero-test-suite-failure-*/failure.json').scanSync({ cwd: root })];
    expect(reports).toHaveLength(1);
    if (kind !== 'inventory') { expect(inventory.count).toBe(4); expect(inventory.failureReport.startsWith(root)).toBe(true); }
    const raw = await Bun.file(join(root, reports[0]!)).text(), receipt = JSON.parse(raw);
    expect(raw).not.toContain('PRIVATE_CAUSE_NOT_FOR_RECEIPT'); expect(raw).not.toContain('SYNTHETIC_OWNED');
    expect(receipt.type).toBe('test-suite-failure-receipt'); expect(receipt.pid).toBe(child.pid);
    expect(receipt.stages[0].console.fault).toEqual({ phase: 'write', trigger: 'native-rejection', nativeCode: 'EPIPE' });
    expect(receipt.stages[0].accounting.workersSettled).toBe(true);
    owned.push(...[...stderr.matchAll(/SYNTHETIC_OWNED (\d+) (\d+)/g)].flatMap(match => [Number(match[1]), Number(match[2])]).filter(pid => pid > 1));
    if (kind === 'event') { expect(owned).toHaveLength(7); expect(receipt.stages[0].accounting.started).toBe(4); }
    if (kind === 'inventory') expect(receipt.stages[0].accounting.started).toBe(0);
    expect(owned.some(exists)).toBe(false);
    expect(stdout).not.toContain('"type":"test-suite-summary"');
  } finally {
    clearTimeout(timer);
    if (child && child.exitCode === null) { child.kill('SIGKILL'); await child.exited; }
    for (const pid of owned) if (exists(pid)) process.kill(pid, 'SIGKILL');
    await rm(root, { recursive: true, force: true });
  }
}, 15000);

test('a timed-out receipt cannot overwrite a later immutable stage receipt after its native write settles', async () => {
  let release!: () => Promise<void>;
  const receipt = await createTestSuiteFailureReceipt(path => {
    const sink = Bun.file(path).writer();
    if (!path.endsWith('failure-1.pending')) return sink;
    return { write(text: string) { return new Promise<number>(resolve => { release = async () => { resolve(await sink.write(text)); }; }); },
      flush: () => sink.flush(), end: () => sink.end(), unref: () => sink.unref() };
  });
  try {
    const console = { queued: 0, completed: 0, active: null, fault: null };
    const accounting = { total: 0, started: 0, completed: 0, workersSettled: true };
    await expect(receipt.persist('main', console, accounting)).rejects.toThrow('boundedly');
    await receipt.persist('close', console, accounting);
    const next = join(receipt.directory, 'failure-2.json'), before = await Bun.file(next).text();
    await release(); await Bun.sleep(20);
    expect(await Bun.file(next).text()).toBe(before);
    expect(JSON.parse(before).attempt).toBe(2); expect(JSON.parse(before).stages).toHaveLength(2);
    expect(await Bun.file(receipt.path).exists()).toBe(false);
  } finally { await receipt.remove(); }
}, 5000);

test.each(['rejected', 'late'] as const)('owned diagnostic-directory %s cleanup cannot delete its replacement failure receipt', async kind => {
  const root = await mkdtemp(join(tmpdir(), 'zero-suite-cleanup-fixture-'));
  let child: Bun.Subprocess<'ignore', 'pipe', 'pipe'> | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Bun.write(join(root, 'one.test.ts'), 'import {test} from "bun:test";test("one",()=>{});');
    const fixture = join(root, 'cli.ts');
    await Bun.write(fixture, `import {runTestSuiteCli} from ${JSON.stringify(join(import.meta.dir, 'run-test-suite.ts'))};
      import {createTestSuiteConsoleWriter} from ${JSON.stringify(join(import.meta.dir, 'test-suite-console-writer.ts'))};
      import {createTestSuiteFailureReceipt} from ${JSON.stringify(join(import.meta.dir, 'test-suite-failure-receipt.ts'))};
      process.exitCode=await runTestSuiteCli(createTestSuiteConsoleWriter(),['--list'],async()=>{
        const receipt=await createTestSuiteFailureReceipt();return {...receipt,remove:async()=>{
          if(${JSON.stringify(kind)}==='late'){await Bun.sleep(1400);await receipt.remove();}
          else throw Error('PRIVATE_CLEANUP_CAUSE');}};
      });`);
    child = Bun.spawn([process.execPath, '--no-env-file', fixture], { cwd: root, env: { TMPDIR: root, PATH: '/usr/bin:/bin' },
      stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
    timer = setTimeout(() => child!.kill('SIGKILL'), 5000);
    const [exit, stdout] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(exit).toBe(2);
    const inventory = JSON.parse(stdout.trim());
    const reports = [...new Bun.Glob('zero-test-suite-failure-*/failure.json').scanSync({ cwd: root })];
    expect(reports).toHaveLength(1);
    const path = join(root, reports[0]!);
    expect(path).not.toBe(inventory.failureReport);
    const raw = await Bun.file(path).text();
    expect(raw).not.toContain('PRIVATE_CLEANUP_CAUSE'); expect(JSON.parse(raw).stages[0].stage).toBe('cleanup');
    expect(JSON.parse(raw).pid).toBe(child.pid);
    if (kind === 'late') await expect(stat(inventory.failureReportDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    clearTimeout(timer);
    if (child && child.exitCode === null) { child.kill('SIGKILL'); await child.exited; }
    await rm(root, { recursive: true, force: true });
  }
}, 5000);

test.each(['write', 'flush'] as const)('receipt native %s rejection still ends and unreferences its exact owned sink once', async phase => {
  let ends = 0, unrefs = 0;
  const receipt = await createTestSuiteFailureReceipt(path => {
    const sink = Bun.file(path).writer();
    return { write(text: string) { if (phase === 'write') throw Error('PRIVATE_WRITE_CAUSE'); return sink.write(text); },
      flush() { if (phase === 'flush') throw Error('PRIVATE_FLUSH_CAUSE'); return sink.flush(); },
      end() { ends++; return sink.end(); }, unref() { unrefs++; sink.unref(); } };
  });
  try {
    await expect(receipt.persist('main', { queued: 0, completed: 0, active: null, fault: null },
      { total: 0, started: 0, completed: 0, workersSettled: true })).rejects.toThrow();
    expect(ends).toBe(1); expect(unrefs).toBe(1);
    expect(await Bun.file(receipt.path).exists()).toBe(false);
  } finally { await receipt.remove(); }
});

test('a synchronous native receipt write exceeding its one-second boundary is never acknowledged or renamed', async () => {
  let ends = 0, unrefs = 0;
  const receipt = await createTestSuiteFailureReceipt(path => {
    const sink = Bun.file(path).writer();
    return { write(text: string) { Bun.sleepSync(1100); return sink.write(text); }, flush: () => sink.flush(),
      end() { ends++; return sink.end(); }, unref() { unrefs++; sink.unref(); } };
  });
  try {
    await expect(receipt.persist('main', { queued: 0, completed: 0, active: null, fault: null },
      { total: 0, started: 0, completed: 0, workersSettled: true })).rejects.toThrow('boundedly');
    expect(ends).toBe(1); expect(unrefs).toBe(1); expect(await Bun.file(receipt.path).exists()).toBe(false);
  } finally { await receipt.remove(); }
});

test.each([['SIGINT', 'write'], ['SIGTERM', 'flush']] as const)(
  '%s retires a held pre-spawn start-event %s without admitting any test child', async (signal, phase) => {
    const root = await mkdtemp(join(tmpdir(), 'zero-suite-event-retirement-'));
    let child: Bun.Subprocess<'ignore', 'pipe', 'pipe'> | undefined, timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const admission = join(root, 'unexpected-child');
      await Bun.write(join(root, 'one.test.ts'), `import {test} from "bun:test";await Bun.write(${JSON.stringify(admission)},"admitted");test("one",()=>{});`);
      const fixture = join(root, 'cli.ts');
      await Bun.write(fixture, `import {runTestSuiteCli} from ${JSON.stringify(join(import.meta.dir, 'run-test-suite.ts'))};
        import {createTestSuiteConsoleWriter} from ${JSON.stringify(join(import.meta.dir, 'test-suite-console-writer.ts'))};
        const sink=Bun.stdout.writer();let held=false;
        const stall=()=>{const marker=Bun.stderr.writer();marker.write('OWNED_START_HELD\\n');marker.flush();marker.unref();return new Promise(()=>{});};
        const stdout={async write(text){held=text.includes('"type":"test-file-start"');
          if(held&&${JSON.stringify(phase)}==='write')return stall();return sink.write(text);},
          flush(){if(held&&${JSON.stringify(phase)}==='flush')return stall();return sink.flush();},
          end:()=>sink.end(),unref:()=>sink.unref()};
        process.exitCode=await runTestSuiteCli(createTestSuiteConsoleWriter({stdout,stderr:Bun.stderr.writer()}));`);
      child = Bun.spawn([process.execPath, '--no-env-file', fixture], { cwd: root, env: { TMPDIR: root, PATH: '/usr/bin:/bin' },
        stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
      timer = setTimeout(() => child!.kill('SIGKILL'), 5000);
      let stderr = '', signalled = false;
      const reading = (async () => {
        const reader = child!.stderr.getReader();
        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            stderr += new TextDecoder().decode(chunk.value);
            if (!signalled && stderr.includes('OWNED_START_HELD')) { signalled = true; child!.kill(signal); }
          }
        } finally { reader.releaseLock(); }
      })();
      const started = performance.now();
      const [exit, stdout] = await Promise.all([child.exited, new Response(child.stdout).text(), reading]);
      expect(signalled).toBe(true); expect(exit).toBe(2); expect(child.signalCode).toBeNull();
      expect(performance.now() - started).toBeLessThan(3000);
      expect(await Bun.file(admission).exists()).toBe(false);
      const inventory = JSON.parse(stdout.split('\n')[0]!);
      const receipt = await Bun.file(inventory.failureReport).json();
      expect(receipt.stages[0].console.fault).toEqual({ phase, trigger: 'output-retired' });
      expect(receipt.stages[0].accounting).toMatchObject({ total: 1, started: 1, completed: 0, workersSettled: true });
    } finally {
      clearTimeout(timer);
      if (child && child.exitCode === null) { child.kill('SIGKILL'); await child.exited; }
      await rm(root, { recursive: true, force: true });
    }
  }, 8000,
);

test.each(['summary', 'error'] as const)('held final %s emission retires boundedly after workers settle and preserves safe failure evidence', async kind => {
  const root = await mkdtemp(join(tmpdir(), 'zero-suite-final-event-'));
  let child: Bun.Subprocess<'ignore', 'pipe', 'pipe'> | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Bun.write(join(root, 'one.test.ts'), 'import {test} from "bun:test";test("one",()=>{});');
    const fixture = join(root, 'cli.ts');
    await Bun.write(fixture, `import {runTestSuiteCli} from ${JSON.stringify(join(import.meta.dir, 'run-test-suite.ts'))};
      import {createTestSuiteConsoleWriter} from ${JSON.stringify(join(import.meta.dir, 'test-suite-console-writer.ts'))};
      const wrap=(channel)=>{const sink=(channel==='stdout'?Bun.stdout:Bun.stderr).writer();return {
        write(text){if(text.includes(${JSON.stringify(`"type":"test-suite-${kind}"`)}))return new Promise(()=>{});return sink.write(text);},
        flush:()=>sink.flush(),end:()=>sink.end(),unref:()=>sink.unref()};};
      process.exitCode=await runTestSuiteCli(createTestSuiteConsoleWriter({stdout:wrap('stdout'),stderr:wrap('stderr')}),
        ${JSON.stringify(kind === 'error' ? ['--file-timeout=0'] : [])});`);
    child = Bun.spawn([process.execPath, '--no-env-file', fixture], { cwd: root, env: { TMPDIR: root, PATH: '/usr/bin:/bin' },
      stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
    timer = setTimeout(() => child!.kill('SIGKILL'), 5000);
    const [exit] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(exit).toBe(2); expect(child.signalCode).toBeNull();
    const reports = [...new Bun.Glob('zero-test-suite-failure-*/failure*.json').scanSync({ cwd: root })];
    const receipts = await Promise.all(reports.map(path => Bun.file(join(root, path)).json()));
    expect(receipts.some(receipt => receipt.stages.some((stage: {console: {fault: unknown}}) => stage.console.fault))).toBe(true);
    if (kind === 'summary') expect(receipts[0].stages[0].accounting).toMatchObject({ completed: 1, workersSettled: true });
  } finally {
    clearTimeout(timer);
    if (child && child.exitCode === null) { child.kill('SIGKILL'); await child.exited; }
    await rm(root, { recursive: true, force: true });
  }
}, 8000);
