/** The theme ledger records actual owned chart paint dependencies, not an invented global theme. */
import { expect, test } from 'bun:test';
import inventory from '../../../../../docs-next/_work/native-chart-token-inventory.json';
test('native theme inventory covers each current renderer/skin token and shared inspector policy', async () => {
  const root = new URL('../../../../../', import.meta.url);
  for (const file of inventory.files) {
    const source = await Bun.file(new URL(file.path, root)).text();
    const current = [...new Set(source.match(/--[a-zA-Z][\w-]*/g) ?? [])].sort();
    expect(file.references).toEqual(current);
  }
  const shared = await Bun.file(new URL('src/components/charts/native/shared/native-chart.css', root)).text();
  for (const name of ['--zero-tooltip-motion-blur-enter', '--zero-tooltip-motion-blur-exit', '--zero-tooltip-blur-shift', '--zero-tooltip-blur-scale', '--zero-chart-inspector-radius', '--zero-chart-inspector-value-size']) expect(shared).toContain(name);
  expect(shared).not.toContain('--tooltip-duration-enter'); expect(shared).toContain('.zero-tooltip-body { padding: 0; }');
  expect(inventory.motion.source).toBe('src/components/charts/arc/shared/motion-tokens.ts');
});
