/** Cosmetic projection validates every own key and never changes admission generation or context lifetime. */
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { modals } from '../../../modals/modal-events';
import { modalStore } from '../../../modals/modal-store';
import { resolveCardFeedback } from './card-presentation';

beforeEach(() => modals.discardAll()); afterEach(() => modals.discardAll());
test('presentation rejects symbol and hidden structural properties and ignores a stale context', () => {
  const handle = modals.show({ title: 'First' }), context = modals.getContext(handle.id)!;
  const symbol = { title: 'Invalid', [Symbol('hidden behavior')]: true };
  const hidden = Object.defineProperty({ title: 'Invalid' }, 'beforeClose', { value: () => true, enumerable: false });
  expect(() => modals.projectPresentation(handle.id, context.signal, symbol)).toThrow(TypeError);
  expect(() => modals.projectPresentation(handle.id, context.signal, hidden)).toThrow(TypeError);
  modals.projectPresentation(handle.id, context.signal, { title: 'Live title', description: 'Live copy', meta: 'Live metadata' });
  expect(modals.getContext(handle.id)).toBe(context); expect(context.signal.aborted).toBe(false);
  expect(modalStore.getSnapshot().context.modals[0]!.generation).toBe(1);
  handle.update({ title: 'Replacement' });
  expect(context.signal.aborted).toBe(true);
  modals.projectPresentation(handle.id, context.signal, { title: 'Stale' });
  expect(modalStore.getSnapshot().context.modals[0]!.title).toBe('Replacement');
});
test('feedback resolves bounded local/canonical presentation and reduced motion suppresses all transforms', () => {
  const properties = new Map([['--zero-card-hover-lift', '3px'], ['--zero-theme-card-media-zoom', '1.07'],
    ['--zero-card-hover-in-duration', '.8s'], ['--zero-card-hover-out-duration', '230ms'],
    ['--zero-card-status-enter-duration', '999999ms'], ['--zero-card-status-blur', '-2px']]);
  const element = { ownerDocument: { defaultView: { getComputedStyle: () => ({ getPropertyValue: (key: string) => properties.get(key) ?? '' }) } } } as unknown as Element;
  const normal = resolveCardFeedback(element, false);
  expect(normal.hoverLiftPx).toBe(3); expect(normal.mediaZoom).toBe(1.07); expect(normal.hoverInMs).toBe(800);
  expect(normal.hoverOutMs).toBe(230); expect(normal.statusEnterMs).toBe(240); expect(normal.statusBlurPx).toBe(4);
  const reduce = resolveCardFeedback(element, true);
  expect(reduce.animate).toBe(false); expect(reduce.hoverLiftPx).toBe(0); expect(reduce.mediaZoom).toBe(1);
  expect(reduce.hoverInMs).toBe(0); expect(reduce.statusEnterMs).toBe(0); expect(reduce.statusBlurPx).toBe(0);
});
