/** Parent leases/SSR isolation for the additive attachment; no browser, configuration or provider runs. */
import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { leaseScrollViewportParent, ScrollViewportAttachment } from './scroll-viewport-attachment';

function parent(position = 'static', inline = '', priority = '') {
  const values = new Map<string, [string, string]>(inline ? [['position', [inline, priority]]] : []);
  return { values, node: { style: {
    getPropertyValue: (name: string) => values.get(name)?.[0] ?? '',
    getPropertyPriority: (name: string) => values.get(name)?.[1] ?? '',
    setProperty: (name: string, value: string, rank = '') => { values.set(name, [value, rank]); },
    removeProperty: (name: string) => { values.delete(name); },
  }, ownerDocument: { defaultView: { getComputedStyle: () => ({ position: values.get('position')?.[0] ?? position }) } } } as unknown as HTMLElement };
}

test('shared static parent remains positioned until the final lease, then restores exact original priority', () => {
  const fixture = parent('static', 'static', 'important');
  const first = leaseScrollViewportParent(fixture.node), second = leaseScrollViewportParent(fixture.node);
  expect(fixture.values.get('position')).toEqual(['relative', 'important']);
  first(); first();
  expect(fixture.values.get('position')).toEqual(['relative', 'important']);
  second();
  expect(fixture.values.get('position')).toEqual(['static', 'important']);
});
test('absent inline position is removed and positioned or externally changed owners are not rewritten', () => {
  const original = parent(); leaseScrollViewportParent(original.node)(); expect(original.values.has('position')).toBe(false);
  for (const position of ['relative', 'absolute', 'fixed', 'sticky']) {
    const positioned = parent(position); leaseScrollViewportParent(positioned.node)(); expect(positioned.values.size).toBe(0);
  }
  const changed = parent(), release = leaseScrollViewportParent(changed.node);
  changed.node.style.setProperty('position', 'sticky'); release();
  expect(changed.values.get('position')).toEqual(['sticky', '']);
});
test('SSR attachment emits no viewport, portal, focus stop or browser geometry read', () => {
  expect(renderToStaticMarkup(<ScrollViewportAttachment viewport={null} />)).toBe('');
  expect(renderToStaticMarkup(<ScrollViewportAttachment viewport={null} enabled={false} orientation="horizontal" />)).toBe('');
});
