/** Local presentation regression: density never changes the editor document or validation contract. */
import * as React from 'react';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { JsonEditor } from './json-editor';
import { JsonTextDraftContext, JsonTextEditor } from './json-editor-widgets';

describe('JsonEditor density', () => {
  test('keeps the full editor default and allows compact presentation with its enclosing scroll owner', () => {
    const unchanged = () => { throw new Error('Rendering must not change the document.'); };
    const full = renderToStaticMarkup(<JsonEditor value={{ enabled: true }} onChange={unchanged} />);
    const compact = renderToStaticMarkup(<JsonEditor value={{ enabled: true }} onChange={unchanged} density="compact" scrollMode="parent" />);
    expect(full).toContain('data-density="default"');
    expect(full).toContain('max-h-[28rem] overflow-auto');
    expect(compact).toContain('data-density="compact"');
    expect(compact).not.toContain('max-h-[28rem] overflow-auto');
    expect(compact).toContain('Structured JSON');
  });

  for (const [density, rows, height] of [['default', 14, 'min-h-64'], ['compact', 6, 'min-h-32']] as const) {
    test(`${density} text preserves invalid raw draft and its accessible label`, () => {
      const context = { raw: { current: '{ invalid' }, disabled: false, label: 'Metadata JSON text', density,
        change() { throw new Error('Rendering must not change a retained draft.'); } };
      const markup = renderToStaticMarkup(<JsonTextDraftContext.Provider value={context}>
        <JsonTextEditor value="{}" onChange={() => undefined} onKeyDown={() => undefined} />
      </JsonTextDraftContext.Provider>);
      expect(markup).toContain(`rows="${rows}"`);
      expect(markup).toContain(height);
      expect(markup).toContain('aria-label="Metadata JSON text"');
      expect(markup).toContain('{ invalid</textarea>');
    });
  }
});
