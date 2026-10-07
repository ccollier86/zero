/** Qualify CLI sink ownership, exact native merged output, backpressure, failures and bounded retirement. */
import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises'; // Bun has no temporary-directory or recursive-directory removal API.
import { tmpdir } from 'node:os'; // Bun has no portable temporary-directory API.
import { join } from 'node:path';
import { createTestSuiteConsoleWriter } from './test-suite-console-writer';
import { drainTestSuiteOutput } from './test-suite-output';

function sink() {
  return { writes: [] as string[], closed: 0, unrefs: 0,
    write(text: string): number | Promise<number> { this.writes.push(text); return new TextEncoder().encode(text).byteLength; },
    flush(): number | Promise<number> { return 0; },
    end(): number | Promise<number> { this.closed++; return 0; },
    unref() { this.unrefs++; },
  };
}

test('one lane waits for actual backpressure, closes once and rejects late admission', async () => {
  const stdout = sink(), stderr = sink();
  let release!: () => void;
  stdout.flush = () => new Promise<number>(resolve => { release = () => resolve(0); });
  const output = createTestSuiteConsoleWriter({ stdout, stderr });
  const first = output.write('stdout', 'first'), second = output.write('stderr', 'second');
  await Bun.sleep(10);
  expect(stdout.writes).toEqual(['first']); expect(stderr.writes).toEqual([]);
  release(); await Promise.all([first, second]);
  expect(stderr.writes).toEqual(['second']);
  const close = output.close(); expect(output.close()).toBe(close); await close;
  expect([stdout.closed, stderr.closed, stdout.unrefs, stderr.unrefs]).toEqual([1, 1, 1, 1]);
  await expect(output.write('stdout', 'late')).rejects.toThrow('closed');
});

test('native Unicode write promises are awaited before the record is flushed', async () => {
  const stdout = sink(), stderr = sink();
  stdout.write = text => { stdout.writes.push(text); return Promise.resolve(new TextEncoder().encode(text).byteLength); };
  const output = createTestSuiteConsoleWriter({ stdout, stderr });
  await output.write('stdout', 'é🚀日本語'); await output.close();
  expect(stdout.writes).toEqual(['é🚀日本語']);
});

test.each([0, 1])('short native byte progress %s is flushed without resending a byte or character suffix', async bytes => {
  const stdout = sink(), stderr = sink(); stdout.write = text => { stdout.writes.push(text); return bytes; };
  const output = createTestSuiteConsoleWriter({ stdout, stderr });
  await output.write('stdout', '🚀'); await output.close();
  expect(stdout.writes).toEqual(['🚀']);
});

test('an asynchronously rejected native write preserves its error and retires both sinks', async () => {
  const stdout = sink(), stderr = sink(), failure = new Error('Synthetic native async write failed.');
  stdout.write = () => Promise.reject(failure);
  const output = createTestSuiteConsoleWriter({ stdout, stderr });
  await expect(output.write('stdout', 'failed')).rejects.toBe(failure);
  await expect(output.close()).rejects.toBe(failure);
  expect([stdout.closed, stderr.closed, stdout.unrefs, stderr.unrefs]).toEqual([1, 1, 1, 1]);
});

test.each(['write', 'flush'] as const)('valid live %s beyond one second does not inherit the post-exit drain deadline', async stage => {
  const stdout = sink(), stderr = sink(), original = stdout[stage].bind(stdout);
  const block = () => { const end = performance.now() + 1050; while (performance.now() < end) {} };
  if (stage === 'write') stdout.write = text => { block(); return original(text); };
  else if (stage === 'flush') stdout.flush = () => { block(); return 0; };
  const output = createTestSuiteConsoleWriter({ stdout, stderr });
  await output.write('stdout', 'live'); await output.close();
  expect([stdout.closed, stderr.closed, stdout.unrefs, stderr.unrefs]).toEqual([1, 1, 1, 1]);
}, 5000);

test.each(['write', 'flush', 'end'] as const)('%s rejection is preserved and both sinks retire', async stage => {
  const stdout = sink(), stderr = sink(), failure = new Error(`Synthetic ${stage} failed.`);
  if (stage === 'write') stdout.write = () => { throw failure; };
  if (stage === 'flush') stdout.flush = () => Promise.reject(failure);
  if (stage === 'end') stdout.end = () => { stdout.closed++; throw failure; };
  const output = createTestSuiteConsoleWriter({ stdout, stderr });
  if (stage !== 'end') await expect(output.write('stdout', 'fail')).rejects.toBe(failure);
  else await output.write('stdout', 'accepted');
  await expect(output.close()).rejects.toBe(failure);
  expect([stdout.closed, stderr.closed, stdout.unrefs, stderr.unrefs]).toEqual([1, 1, 1, 1]);
});

test('post-exit one-second drain retires an active writer and queued writes cannot publish late', async () => {
  const stdout = sink(), stderr = sink(); let release!: () => void;
  stdout.flush = () => new Promise<number>(resolve => { release = () => resolve(0); });
  const output = createTestSuiteConsoleWriter({ stdout, stderr }), started = performance.now();
  const streams = { stdout: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array([65])); controller.close(); } }),
    stderr: new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } }) };
  const drain = drainTestSuiteOutput(streams, (channel, text, signal) => output.write(channel, text, signal));
  await Bun.sleep(0);
  const queued = output.write('stderr', 'never').catch(() => {});
  expect(await drain.settle()).toMatchObject({ outputIncomplete: true }); await queued;
  expect(performance.now() - started).toBeGreaterThanOrEqual(900);
  expect(stderr.writes).toEqual([]);
  expect(output.diagnostics().fault).toMatchObject({ trigger: 'output-retired', phase: 'flush' });
  release(); await expect(output.close()).rejects.toThrow('retired');
  expect(stderr.writes).toEqual([]); expect([stdout.unrefs, stderr.unrefs]).toEqual([1, 1]);
}, 5000);

test('canceling a queued call does not fault the lane, skip another record or overlap valid live output', async () => {
  const stdout = sink(), stderr = sink(); let release!: () => void;
  stdout.flush = () => new Promise<number>(resolve => { release = () => resolve(0); });
  const output = createTestSuiteConsoleWriter({ stdout, stderr }), controller = new AbortController();
  const first = output.write('stdout', 'live');
  const canceled = output.write('stderr', 'retired', controller.signal).catch(() => {});
  const third = output.write('stderr', 'valid');
  await Bun.sleep(1100); controller.abort(); await canceled;
  expect(output.diagnostics().fault).toBeNull(); expect(stderr.writes).toEqual([]);
  release(); await Promise.all([first, third]); await output.close();
  expect(stderr.writes).toEqual(['valid']);
}, 5000);

test('held final close is bounded and unrefs both owned sinks without converting failure to success', async () => {
  const stdout = sink(), stderr = sink(); stdout.end = () => new Promise<number>(() => {});
  const output = createTestSuiteConsoleWriter({ stdout, stderr }), started = performance.now();
  await output.write('stderr', 'accepted');
  await expect(output.close()).rejects.toThrow('final close exceeded');
  expect(performance.now() - started).toBeGreaterThanOrEqual(900);
  expect([stdout.unrefs, stderr.unrefs]).toEqual([1, 1]);
}, 5000);

test('real native stdout/stderr preserve concurrent JSON events and eight channels in one merged regular file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'zero-suite-console-'));
  const fixture = `${root}/writer.ts`, outputPath = `${root}/output.log`;
  let child: Bun.Subprocess<'ignore', 'ignore', 'ignore'> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Bun.write(fixture, `import {createTestSuiteConsoleWriter} from ${JSON.stringify(`${import.meta.dir}/test-suite-console-writer.ts`)};
      const output=createTestSuiteConsoleWriter();
      await Promise.all(Array.from({length:12},async(_,lane)=>{
        for(let index=0;index<32;index++) await output.write(lane<4?'stdout':'stderr',lane<4
          ?JSON.stringify({type:'event',lane,index})+'\\n'
          :'[child-'+Math.floor((lane-4)/2)+':'+((lane-4)%2?'stderr':'stdout')+'] '+index+' 🚀\\n');
      }));await output.close();`);
    child = Bun.spawn(['/bin/sh', '-c', 'exec "$1" --no-env-file "$2" > "$3" 2>&1',
      'zero-console-fixture', process.execPath, fixture, outputPath],
      { cwd: root, stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' });
    timer = setTimeout(() => child!.kill('SIGKILL'), 5000);
    expect(await child.exited).toBe(0); clearTimeout(timer);
    const bytes = await Bun.file(outputPath).bytes(), text = new TextDecoder().decode(bytes);
    const actual = text.trimEnd().split('\n'), expected: string[] = [];
    for (let lane = 0; lane < 12; lane++) for (let index = 0; index < 32; index++) expected.push(lane < 4
      ? JSON.stringify({ type: 'event', lane, index })
      : `[child-${Math.floor((lane - 4) / 2)}:${(lane - 4) % 2 ? 'stderr' : 'stdout'}] ${index} 🚀`);
    expect([...actual].sort()).toEqual([...expected].sort()); expect(actual).toHaveLength(384);
    expect(bytes.includes(0)).toBe(false);
  } finally {
    clearTimeout(timer);
    if (child && child.exitCode === null) { child.kill('SIGKILL'); await child.exited; }
    await rm(root, { recursive: true, force: true });
  }
}, 10000);

test('an actual unread native pipe applies backpressure and fails boundedly without leaving its child alive', async () => {
  const root = await mkdtemp(join(tmpdir(), 'zero-suite-console-pipe-'));
  const fixture = `${root}/writer.ts`, report = `${root}/report.json`, fifo = `${root}/held.fifo`;
  let child: Bun.Subprocess<'ignore', 'pipe', 'pipe'> | undefined;
  let holder: Bun.Subprocess<'pipe', 'ignore', 'ignore'> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Bun subprocess pipes eagerly drain into native buffers. An owned FIFO and
    // held reader impose actual kernel backpressure without another JS consumer.
    const mkfifo = Bun.which('mkfifo');
    if (!mkfifo) throw new Error('Native FIFO coverage requires mkfifo on this supported test host.');
    const setup = Bun.spawn([mkfifo, fifo], { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' });
    expect(await setup.exited).toBe(0);
    holder = Bun.spawn(['/bin/sh', '-c', 'exec 3<"$1"; read hold', 'zero-console-holder', fifo],
      { stdin: 'pipe', stdout: 'ignore', stderr: 'ignore' });
    await Bun.write(fixture, `import {createTestSuiteConsoleWriter} from ${JSON.stringify(`${import.meta.dir}/test-suite-console-writer.ts`)};
      const output=createTestSuiteConsoleWriter();let writeFailed=false,closeFailed=false;
      try{await output.write('stdout','x'.repeat(1024*1024),AbortSignal.timeout(1000));}catch{writeFailed=true;}
      try{await output.close();}catch{closeFailed=true;}
      await Bun.write(${JSON.stringify(report)},JSON.stringify({writeFailed,closeFailed}));
      process.exitCode=writeFailed&&closeFailed?2:0;`);
    child = Bun.spawn(['/bin/sh', '-c', 'exec "$1" --no-env-file "$2" > "$3"',
      'zero-console-fifo-writer', process.execPath, fixture, fifo],
      { cwd: root, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
    timer = setTimeout(() => child!.kill('SIGKILL'), 5000);
    // Deliberately do not read stdout until the child's bounded failure has settled.
    expect(await child.exited).toBe(2); clearTimeout(timer);
    expect(await Bun.file(report).json()).toEqual({ writeFailed: true, closeFailed: true });
    expect(child.signalCode).toBeNull();
  } finally {
    clearTimeout(timer);
    if (child && child.exitCode === null) { child.kill('SIGKILL'); await child.exited; }
    if (holder && holder.exitCode === null) { holder.kill('SIGKILL'); await holder.exited; }
    await holder?.stdin.end();
    await child?.stdout.cancel(); await child?.stderr.cancel();
    await rm(root, { recursive: true, force: true });
  }
}, 10000);

test('native pipe buffering accepts a large Unicode record completely rather than reporting a short write', async () => {
  const root = await mkdtemp(join(tmpdir(), 'zero-suite-console-unicode-'));
  const fixture = join(root, 'writer.ts'), expected = 'é🚀日本語\n'.repeat(65536);
  let child: Bun.Subprocess<'ignore', 'pipe', 'pipe'> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Bun.write(fixture, `import {createTestSuiteConsoleWriter} from ${JSON.stringify(`${import.meta.dir}/test-suite-console-writer.ts`)};
      const output=createTestSuiteConsoleWriter();
      await output.write('stdout','é🚀日本語\\n'.repeat(65536));await output.close();`);
    child = Bun.spawn([process.execPath, '--no-env-file', fixture],
      { cwd: root, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
    timer = setTimeout(() => child!.kill('SIGKILL'), 5000);
    const [exit, stdout, stderr] = await Promise.all([child.exited,
      new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(exit).toBe(0); expect(stderr).toBe(''); expect(stdout).toBe(expected);
  } finally {
    clearTimeout(timer);
    if (child && child.exitCode === null) { child.kill('SIGKILL'); await child.exited; }
    await rm(root, { recursive: true, force: true });
  }
}, 10000);
