/** Read-only geometric qualification of a real managed origin exit in synthetic browser fixtures. */
import { expect } from 'bun:test';
import type { Page } from 'playwright';

export async function expectManagedOriginExit(page: Page, slot: string, triggerId: string,
  opening: { x: number; y: number; width: number; height: number }): Promise<void> {
  const paint = page.locator(`.zero-modal__exit-paint [data-slot="${slot}"]`);
  await paint.waitFor();
  const sample = await paint.evaluate((element, triggerId) => {
    const trigger = document.querySelector<HTMLElement>(`[data-testid="${triggerId}"]`)!.getBoundingClientRect();
    const frame = element.getAnimations().flatMap(animation => {
      const effect = animation.effect as KeyframeEffect | null, end = effect?.getKeyframes().at(-1);
      return end?.transform && end.transform !== 'none' ? [{ transform: String(end.transform), duration: effect!.getTiming().duration }] : [];
    }).at(-1);
    const matrix = frame ? new DOMMatrixReadOnly(frame.transform) : null;
    return { inert: (element as HTMLElement).inert, aria: element.getAttribute('aria-hidden'), duration: frame?.duration,
      sx: matrix?.m11, sy: matrix?.m22, x: matrix?.m41, y: matrix?.m42,
      trigger: { x: trigger.x, y: trigger.y, width: trigger.width, height: trigger.height } };
  }, triggerId);
  expect(sample).toMatchObject({ inert: true, aria: 'true', duration: 570 });
  expect(sample.sx!).toBeCloseTo(sample.trigger.width / opening.width, 3);
  expect(sample.sy!).toBeCloseTo(sample.trigger.height / opening.height, 3);
  expect(sample.x!).toBeCloseTo(sample.trigger.x + sample.trigger.width / 2 - opening.x - opening.width / 2, 1);
  expect(sample.y!).toBeCloseTo(sample.trigger.y + sample.trigger.height / 2 - opening.y - opening.height / 2, 1);
  expect(await page.locator('[role="dialog"]').count()).toBe(0); // only inert paint, not a second interactive frame
  await paint.waitFor({ state: 'detached' });
}
