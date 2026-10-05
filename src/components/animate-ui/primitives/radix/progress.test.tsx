import { describe, expect, spyOn, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { Progress, ProgressIndicator } from './progress';

function markup(value: number | null | undefined, max?: number) {
  return renderToStaticMarkup(<Progress value={value} max={max}>
    <ProgressIndicator initial={false} />
  </Progress>);
}

describe('progress indicator matches the declared Radix range', () => {
  test.each([[5, 10], [500, 1000], [0.5, 1]])('value %s / max %s displays one half', (value, max) => {
    const html = markup(value, max);
    expect(html).toContain('translateX(-50%)');
    expect(html).toContain(`aria-valuemax="${max}"`);
    expect(html).toContain(`aria-valuenow="${value}"`);
  });

  test('zero, completion and default max retain their established projections', () => {
    expect(markup(0, 10)).toContain('translateX(-100%)');
    expect(markup(10, 10)).toContain('transform:none');
    expect(markup(25)).toContain('translateX(-75%)');
  });

  test('invalid max and invalid/null values follow the normalized Radix root rather than overflow the bar', () => {
    const error = spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      for (const max of [0, -1, Number.NaN]) {
        const html = markup(50, max);
        expect(html).toContain('aria-valuemax="100"');
        expect(html).toContain('translateX(-50%)');
      }
      for (const value of [null, undefined, -1, 11, Number.NaN]) {
        const html = markup(value, 10);
        expect(html).toContain('data-state="indeterminate"');
        expect(html).not.toContain('aria-valuenow=');
        expect(html).toContain('translateX(-100%)');
      }
    } finally { error.mockRestore(); }
  });
});
