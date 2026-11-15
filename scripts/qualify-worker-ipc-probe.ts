/** Payload-free synthetic Bun spawn/IPC diagnostic; no Zero services, files, secrets or application boot. */
if (process.argv.includes('--probe-child')) {
  console.log(JSON.stringify({ stage: 'child', ipc: typeof process.send === 'function', connected: process.connected, arch: process.arch }));
  if (typeof process.send === 'function') process.send({ ready: true });
  console.log(JSON.stringify({ stage: 'child-send-returned' }));
  setTimeout(() => { console.log(JSON.stringify({stage:'child-timer-fired'}));process.disconnect?.();process.exit(0); }, 2000);
} else {
  let received = false;
  const child = Bun.spawn([process.execPath, '--no-env-file', import.meta.path, '--probe-child'], {
    env: {}, detached: true, serialization: 'advanced', stdin: 'ignore', stdout: 'inherit', stderr: 'inherit',
    ipc(message) { if (message && (message as { ready?: unknown }).ready === true) received = true; },
  });
  const timer = setTimeout(() => child.kill('SIGKILL'), 12_000);
  try { console.log(JSON.stringify({ stage: 'parent', childExit: await child.exited, received, arch: process.arch })); }
  finally { clearTimeout(timer); }
  if (!received) process.exitCode = 1;
}
