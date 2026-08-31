/**
 * animation-loop.test.ts
 *
 * Guards the event-loop yield required between animated-icon loop turns.
 */

import { describe, expect, it } from 'bun:test';
import { scheduleAnimationLoopTurn } from './animation-loop';

describe('scheduleAnimationLoopTurn', () => {
  it('uses a timer task even when the configured delay is zero', async () => {
    let precedingTimerRan = false;

    const precedingTimer = new Promise<void>((resolve) => {
      setTimeout(() => {
        precedingTimerRan = true;
        resolve();
      }, 0);
    });

    await new Promise<void>((resolve) => {
      scheduleAnimationLoopTurn(0, resolve);
    });

    expect(precedingTimerRan).toBe(true);
    await precedingTimer;
  });

  it('honors a positive loop delay', async () => {
    const startedAt = performance.now();

    await new Promise<void>((resolve) => {
      scheduleAnimationLoopTurn(10, resolve);
    });

    expect(performance.now() - startedAt).toBeGreaterThanOrEqual(5);
  });
});
