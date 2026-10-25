/** Exercise the real email sanitizer from a relocated bundle with no dependency directory. */
import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCssTreeBuildPlugin } from './css-tree-build-plugin';

test('bundled email CSS retains grammar validation and remote-content denial after relocation', async () => {
  const root = await mkdtemp(join(process.env.PROJECT_SCRATCH_DIR ?? tmpdir(), 'zero-css-tree-build-'));
  try {
    const source = join(root, 'source'), output = join(root, 'bundle'), relocated = join(root, 'relocated');
    await mkdir(source); await mkdir(output);
    const entry = join(source, 'entry.ts');
    await Bun.write(entry, [
      `import {sanitizeEmailCss,createEmailCssBudget} from ${JSON.stringify(join(import.meta.dir, '../components/email-inbox/html/email-css.ts'))};`,
      'const clean=s=>sanitizeEmailCss(s,true,createEmailCssBudget());',
      'console.log(JSON.stringify({valid:clean("color:red;padding:12px"),invalid:clean("color:bananas;padding:bananas"),remote:clean("background:url(https://tracking.invalid/pixel);color:blue"),active:clean("width:expression(alert(1));color:green")}));',
    ].join('\n'));
    const built = await Bun.build({ entrypoints: [entry], outdir: output, target: 'bun', format: 'esm', plugins: [createCssTreeBuildPlugin()] });
    expect(built.success).toBe(true);
    await rename(output, relocated);
    await rm(source, { recursive: true });
    const child = Bun.spawn(['bun', '--no-env-file', join(relocated, 'entry.js')], { cwd: relocated, env: { PATH: Bun.env.PATH }, stdout: 'pipe', stderr: 'pipe' });
    const out = new Response(child.stdout).text(), error = new Response(child.stderr).text();
    const timeout = setTimeout(() => child.kill('SIGKILL'), 10_000);
    try {
      expect(await child.exited).toBe(0); expect(await error).toBe('');
      expect(JSON.parse(await out)).toEqual({ valid: 'color:red;padding:12px', invalid: '', remote: 'color:blue', active: 'color:green' });
    } finally { clearTimeout(timeout); }
  } finally { await rm(root, { recursive: true, force: true }); }
});
