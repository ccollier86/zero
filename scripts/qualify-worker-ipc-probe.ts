/** Bidirectional payload-free Bun IPC probe. No Zero services, databases, dependencies, secrets or application boot. */
if (process.argv.includes('--probe-child')) {
  const started = Date.now(); let answered = false;
  const expiry = setTimeout(() => {
    console.log(JSON.stringify({ stage: 'child-expired', elapsedMs: Date.now() - started }));
    process.disconnect?.(); process.exit(1);
  }, 10_000);
  // Simulate asynchronous entry/bootstrap work before a child attaches IPC.
  // This checks message preservation separately from dependency import cost.
  if (process.argv.includes('--delay-listener')) await Bun.sleep(250);
  process.on('message', value => {
    if (!value || typeof value !== 'object' || (value as { ping?: unknown }).ping !== true || answered) return;
    answered = true;
    console.log(JSON.stringify({ stage: 'child-ping', elapsedMs: Date.now() - started }));
    process.send?.({ reply: true });
    setTimeout(() => { clearTimeout(expiry); process.disconnect?.(); process.exit(0); }, 100);
  });
  console.log(JSON.stringify({ stage: 'child-ready', ipc: typeof process.send === 'function', connected: process.connected, arch: process.arch }));
  process.send?.({ ready: true });
} else {
  for (const mode of ['immediate', 'after-ready', 'delayed-listener']) {
    const started = Date.now(); let readyAt: number | null = null, replyAt: number | null = null, sent = false;
    const child = Bun.spawn([process.execPath, '--no-env-file', import.meta.path, '--probe-child', ...(mode === 'delayed-listener' ? ['--delay-listener'] : [])], {
      env: {}, detached: true, serialization: 'advanced', stdin: 'ignore', stdout: 'inherit', stderr: 'inherit',
      ipc(message) {
        if (!message || typeof message !== 'object') return;
        if ((message as { ready?: unknown }).ready === true) {
          readyAt = Date.now() - started;
          if (mode === 'after-ready' && !sent) { sent = true; child.send({ ping: true }); }
        }
        if ((message as { reply?: unknown }).reply === true) replyAt = Date.now() - started;
      },
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), 12_000);
    try {
      if (mode !== 'after-ready') { sent = true; child.send({ ping: true }); }
      const exit = await child.exited;
      console.log(JSON.stringify({ stage: 'parent-result', mode, exit, readyAtMs: readyAt, replyAtMs: replyAt, elapsedMs: Date.now() - started, arch: process.arch }));
      if (exit !== 0 || readyAt === null || replyAt === null) process.exitCode = 1;
    } finally { clearTimeout(timer); if (child.exitCode === null) { child.kill('SIGKILL'); await child.exited; } }
  }
}
