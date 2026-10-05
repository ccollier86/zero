/** Verifies hold duration admission before a browser frame can be scheduled. */

import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { HoldButton } from './hold-button';

describe('HoldButton duration configuration', () => {
  test('rejects zero, negative, nonfinite and untyped durations at render', () => {
    for (const duration of [0, -1, Number.NaN, Infinity, -Infinity, '200']) {
      expect(() => renderToStaticMarkup(
        <HoldButton holdDuration={duration as number} onConfirm={() => {}} />,
      )).toThrow('HoldButton holdDuration must be a finite number greater than zero.');
    }
  });

  test('renders the default and explicit positive finite durations without running callbacks', () => {
    let confirmations = 0;
    for (const duration of [undefined, 0.5, 200, 1500]) {
      const html = renderToStaticMarkup(
        <HoldButton holdDuration={duration} onConfirm={() => { confirmations += 1; }} />,
      );
      expect(html).toContain('Hold to Delete');
    }
    expect(confirmations).toBe(0);
  });
});
