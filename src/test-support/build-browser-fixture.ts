/** Compile synthetic UI separately from the test process's imported server/React graph.
 * Native app/plugin builds still run normally in the parent; this owns fixture bytes only.
 */
export async function buildBrowserFixture(entry: string): Promise<{ script: string; css: string }> {
  const source = `try {
    const result = await Bun.build({ entrypoints: [${JSON.stringify(entry)}], target: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': JSON.stringify('test') } });
    if (!result.success) throw new Error(result.logs.map(item => item.message).join('\\n'));
    const script = await result.outputs.find(item => item.path.endsWith('.js')).text();
    const css = (await Promise.all(result.outputs.filter(item => item.path.endsWith('.css')).map(item => item.text()))).join('\\n');
    await Bun.write(Bun.stdout, JSON.stringify({ script, css }));
  } catch (error) { console.error(error); process.exitCode = 1; }`;
  const child = Bun.spawn({ cmd: [process.execPath, '--no-env-file', '-e', source], cwd: `${import.meta.dir}/../..`, stdout: 'pipe', stderr: 'pipe' });
  const deadline = setTimeout(() => { child.kill('SIGKILL'); }, 30_000);
  let output: string, diagnostic: string, code: number;
  try { [output, diagnostic, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]); }
  finally { clearTimeout(deadline); }
  if (code !== 0) throw new Error(diagnostic || 'Synthetic browser fixture compilation failed.');
  const value = JSON.parse(output);
  if (!value || typeof value.script !== 'string' || typeof value.css !== 'string') throw new Error('Invalid synthetic browser build result.');
  return value;
}
