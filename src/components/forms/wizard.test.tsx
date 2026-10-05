/** Verifies schema-backed Wizard configuration and server-rendering boundaries. */

import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { defineSchema } from '../../schema/define-schema';
import { field } from '../../schema/field-types';
import { Wizard, type WizardStep } from './wizard';

const schema = defineSchema({
  name: field.text({ required: true }),
  notes: field.text(),
});

function renderWizard(steps: WizardStep[]): string {
  return renderToStaticMarkup(
    <Wizard schema={schema} steps={steps} onComplete={() => undefined} />,
  );
}

describe('Wizard configuration', () => {
  test('rejects an empty step list with an actionable configuration error', () => {
    expect(() => renderWizard([])).toThrow('Wizard requires at least one step.');
  });

  test('rejects an unknown field rather than silently hiding or skipping it', () => {
    expect(() => renderWizard([
      { title: 'Details', fields: ['missing'] },
    ])).toThrow("Wizard step 1 references unknown schema field 'missing'.");
  });

  test('checks every step before navigation, including later steps', () => {
    expect(() => renderWizard([
      { title: 'Details', fields: ['name'] },
      { title: 'More', fields: ['missing'] },
    ])).toThrow("Wizard step 2 references unknown schema field 'missing'.");
  });

  test('renders registered fields and multi-step navigation', () => {
    const markup = renderWizard([
      { title: 'Details', fields: ['name'] },
      { title: 'More', fields: ['notes'] },
    ]);
    expect(markup).toContain('data-slot="wizard"');
    expect(markup).toContain('name="name"');
    expect(markup).toContain('Details');
    expect(markup).toContain('Next');
  });

  test('permits a deliberate fieldless review step', () => {
    const markup = renderWizard([{ title: 'Review', fields: [] }]);
    expect(markup).toContain('Review');
    expect(markup).toContain('Complete');
  });
});
