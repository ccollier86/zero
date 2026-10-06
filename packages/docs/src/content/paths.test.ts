import { expect, spyOn, test } from 'bun:test';
import { docsFixture } from './test-fixture';
import { readDocsBytes } from './paths';

test('a source growing between stat and read is capped before allocation and still rejected', async () => {
  const fixture = await docsFixture({ 'growing.md': '12345678' }), path = fixture.root + '/growing.md';
  const original = Bun.file.bind(Bun); let uncappedReads = 0; const slices: unknown[][] = []; let changed = false;
  const spy = spyOn(Bun, 'file').mockImplementation((source, options) => {
    if (source !== path) return typeof source === 'number' ? original(source, options) : typeof source === 'string' || source instanceof URL ? original(source, options) : original(source, options);
    if (!changed) {
      changed = true;
      const growth = Bun.spawnSync({ cmd: ['bun', '-e', 'await Bun.write(process.argv[1], "x".repeat(4096))', path], stdout: 'ignore', stderr: 'pipe' });
      expect(growth.exitCode).toBe(0);
    }
    const file = original(source, options);
    return new Proxy(file, { get(target, key) {
      if (key === 'slice') return (...args: [number?, number?, string?]) => { slices.push(args); return target.slice(...args); };
      if (key === 'arrayBuffer') return () => { uncappedReads++; return target.arrayBuffer(); };
      const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
    } });
  });
  try { await expect(readDocsBytes(fixture.root, 'growing.md', 8)).rejects.toMatchObject({ code: 'DOCS_LIMIT_EXCEEDED' }); expect(changed).toBe(true); expect(slices).toEqual([[0, 9]]); expect(uncappedReads).toBe(0); }
  finally { spy.mockRestore(); await fixture.close(); }
});
