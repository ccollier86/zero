/** Exercise a copied fixture in a fresh consumer bundler, not Bun's reused in-test resolver. */
export async function buildSourceCopyBrowserFixture(entrypoint: string, outdir: string, cwd: string): Promise<void> {
  const child = Bun.spawn({ cmd: [process.execPath, '--no-env-file', 'build', entrypoint,
    '--target', 'browser', '--outdir', outdir], cwd, stdout: 'pipe', stderr: 'pipe' });
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; child.kill(); }, 110_000);
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    if (timedOut || exitCode !== 0) throw new Error(timedOut
      ? 'Copied browser fixture build timed out.'
      : `${stdout}\n${stderr}`.trim() || `Copied browser fixture exited with code ${exitCode}.`);
  } finally { clearTimeout(timeout); }
}
