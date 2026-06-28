/**
 * registry.test.ts
 *
 * Verifies Zero's animated icon registry contracts. This file owns icon lookup
 * tests only; it does not render icon SVG output.
 */

import { describe, expect, it } from 'bun:test';
import {
  ArrowRight,
  Trash,
  getZeroAnimatedIcon,
  hasZeroAnimatedIcon,
  resolveZeroAnimatedIcon,
  zeroAnimatedIconNames,
  zeroAnimatedIcons,
} from './index';

describe('zero animated icon registry', () => {
  it('exposes canonical icon names and components', () => {
    expect(zeroAnimatedIconNames).toContain('arrow-right');
    expect(zeroAnimatedIconNames).toContain('trash');
    expect(zeroAnimatedIconNames.length).toBe(Object.keys(zeroAnimatedIcons).length);
  });

  it('resolves typed and untyped icon names', () => {
    expect(getZeroAnimatedIcon('arrow-right')).toBe(ArrowRight);
    expect(resolveZeroAnimatedIcon('trash')).toBe(Trash);
    expect(resolveZeroAnimatedIcon('folder')).toBeNull();
  });

  it('narrows arbitrary strings with hasZeroAnimatedIcon', () => {
    expect(hasZeroAnimatedIcon('arrow-right')).toBe(true);
    expect(hasZeroAnimatedIcon('folder-open')).toBe(false);
  });
});
