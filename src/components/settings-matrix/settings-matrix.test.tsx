/** Verify tokenized SSR composition, accessible controls and truthful controlled-value states. */

import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SettingsMatrix } from './settings-matrix';
import { readSettingsMatrixCell, settingsMatrixCellIsEditable, validateSettingsMatrixDescriptors } from './settings-matrix-model';
import type { SettingsMatrixProps } from './settings-matrix-types';

function props(): SettingsMatrixProps {
  return { title: 'Notifications', description: 'Choose where updates appear.',
    columns: [{ id: 'in-app', label: 'In app', icon: createElement('svg', { 'data-example-icon': true }) },
      { id: 'email', label: 'Email' }, { id: 'push', label: 'Push' }],
    rows: [{ id: 'comments', label: 'Comments', description: 'Replies and mentions on your work.' },
      { id: 'security', label: 'Security', description: 'Important account updates.',
        cells: { email: { disabled: true, disabledReason: 'Required security alerts cannot be changed.' } } }],
    value: { comments: { 'in-app': true, email: false, push: false }, security: { 'in-app': true, email: true } },
    onChange: () => {}, help: 'Changes apply to your preferences only.' };
}
function render(input: SettingsMatrixProps) { return renderToStaticMarkup(createElement(SettingsMatrix, input)); }

describe('SettingsMatrix presentation', () => {
  test('renders compact labeled choice columns, controlled values, descriptions and footer', () => {
    const html = render(props());
    expect(html).toContain('data-slot="settings-matrix"'); expect(html).toContain('Notifications');
    expect(html).toContain('Replies and mentions on your work.'); expect(html).toContain('scope="col"');
    expect(html).toContain('scope="row"'); expect(html).toContain('aria-label="Comments: Email"');
    expect(html).toContain('data-state="checked"'); expect(html).toContain('data-state="unchecked"');
    expect(html).toContain('3 enabled · 4 editable'); expect(html).toContain('Changes apply to your preferences only.');
    expect(html).toContain('border-border'); expect(html).toContain('bg-card');
    expect(html).toContain('data-slot="checkbox"');
  });

  test('read-only presentation retains selections without implying editable authority', () => {
    const html = render({ ...props(), readOnly: true });
    expect(html).toContain('aria-readonly="true"'); expect(html).toContain('disabled=""');
    expect(html).toContain('3 enabled · 0 editable'); expect(html).toContain('data-state="checked"');
  });

  test('omitted values are unavailable rather than unchecked controls', () => {
    const input = props();
    const cell = readSettingsMatrixCell(input, input.rows[1]!, input.columns[2]!);
    expect(cell.checked).toBeNull(); expect(settingsMatrixCellIsEditable(cell)).toBe(false);
    expect(render(input)).toContain('Security: Push: not available');
  });

  test('disabled reasons remain accessible through a focusable tooltip trigger', () => {
    const html = render(props());
    expect(html).toContain('Security: Email: Required security alerts cannot be changed.');
    expect(html).toContain('tabindex="0"');
  });

  test('switch mode uses Zero switches, and no callback is implicitly read-only', () => {
    const html = render({ ...props(), control: 'switch', onChange: undefined });
    expect(html).toContain('role="switch"'); expect(html).not.toContain('role="checkbox"');
    expect(html).toContain('3 enabled · 0 editable');
  });

  test('empty settings preserve headers and a deliberate empty state', () => {
    const html = render({ ...props(), rows: [], value: {}, emptyMessage: 'No configured choices.' });
    expect(html).toContain('No configured choices.'); expect(html).toContain('In app');
    expect(html).toContain('0 enabled · 0 editable');
  });

  test('descriptor validation rejects zero/more than three columns and duplicate identities', () => {
    const input = props();
    expect(() => validateSettingsMatrixDescriptors({ ...input, columns: [] })).toThrow('one to three');
    expect(() => validateSettingsMatrixDescriptors({ ...input, columns: [...input.columns, { id: 'four', label: 'Four' }] })).toThrow('one to three');
    expect(() => validateSettingsMatrixDescriptors({ ...input, rows: [...input.rows, input.rows[0]!] })).toThrow('unique nonempty');
    expect(() => validateSettingsMatrixDescriptors({ ...input, columns: [{ id: '', label: 'Unnamed' }] })).toThrow('unique nonempty');
  });

  test('prototype names and missing controlled properties cannot create fake checked choices', () => {
    const input: SettingsMatrixProps = { columns: [{ id: 'constructor', label: 'Constructor' }],
      rows: [{ id: 'toString', label: 'Prototype row' }], value: {}, onChange: () => {} };
    expect(readSettingsMatrixCell(input, input.rows[0]!, input.columns[0]!).checked).toBeNull();
    expect(render(input)).toContain('0 enabled · 0 editable');
  });
});
