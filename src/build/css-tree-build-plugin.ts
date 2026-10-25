/** Keep CSS Tree's grammar data inside server bundles without changing email CSS policy. */
import { createRequire } from 'node:module';
import { join } from 'node:path';

export function createCssTreeBuildPlugin(): Bun.BunPlugin {
  return {
    name: 'zero-css-tree-static-data',
    setup(build) {
      // The public ESM export loads JSON with createRequire(import.meta.url).
      // Its public require export uses static requires that Bun can embed. Resolve
      // that conditional export at build time, from the actual consumer package.
      build.onResolve({ filter: /^css-tree$/u }, ({ resolveDir }) => ({
        path: createRequire(join(resolveDir, '__zero_css_tree_build__.cjs')).resolve('css-tree'),
      }));
    },
  };
}
