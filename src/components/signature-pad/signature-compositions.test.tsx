import { describe, expect, test } from 'bun:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SignatureAgreementCard } from './signature-agreement-card';
import { ClauseInitials } from './clause-initials';

const ink = [{ points: [[12, 30, 2] as const, [60, 45, 2] as const] }];

describe('signature composition server rendering', () => {
  test('a draft renders ordinary Zero fields without inventing a signed date', () => {
    const html = renderToStaticMarkup(<SignatureAgreementCard sourceKey="contract-1" onSign={async () => ({ signedAt: '2026-10-05T14:20:00.000Z' })}>
      <p>Readable agreement terms.</p>
    </SignatureAgreementCard>);
    expect(html).toContain('Readable agreement terms.');
    expect(html).toContain('Signature required');
    expect(html).toContain('Full name');
    expect(html).toContain('Sign agreement');
    expect(html).not.toContain('<time');
    expect(html).not.toContain('data-state="signed"');
  });

  test('a prefilled acknowledged signature is canonical, read-only and dated in UTC', () => {
    const html = renderToStaticMarkup(<SignatureAgreementCard sourceKey="contract-1" signed={{ strokes: ink,
      signedAt: '2026-10-05T14:20:00.000Z', signerName: 'Casey <private>', svg: '<svg onload="steal()"/>' }} />);
    expect(html).toContain('data-state="signed"');
    expect(html).toContain('data-readonly="true"');
    expect(html).toContain('Signed by Casey &lt;private&gt;');
    expect(html).toContain('dateTime="2026-10-05T14:20:00.000Z"');
    expect(html).toContain(' UTC');
    expect(html).not.toContain('steal');
    expect(html).not.toContain('signature-pad-clear');
    expect(html).not.toContain('Sign agreement');
  });

  test('an invalid external receipt disables signing instead of displaying supplied SVG', () => {
    const html = renderToStaticMarkup(<SignatureAgreementCard sourceKey="contract-1" signed={{ strokes: ink,
      signedAt: 'not-a-date', svg: '<svg onload="steal()"/>' }} />);
    expect(html).toContain('The saved signature could not be verified for display.');
    expect(html).toContain('data-readonly="true"');
    expect(html).not.toContain('steal');
    expect(html).not.toContain('<time');
  });

  test('an agreement requires an explicit source boundary', () => {
    expect(() => renderToStaticMarkup(<SignatureAgreementCard sourceKey=" " />)).toThrow('sourceKey');
  });

  test('compact initials count current ink and expose stable native field names', () => {
    const html = renderToStaticMarkup(<ClauseInitials clauses={[{ id: 'privacy', label: 'Privacy clause' }, { id: 'billing', label: 'Billing clause' }]}
      defaultValue={{ privacy: ink, billing: [{ points: [] }], removed: ink }} namePrefix="contract" required />);
    expect(html).toContain('1 of 2 initialed');
    expect(html).toContain('name="contract.privacy"');
    expect(html).toContain('name="contract.billing"');
    expect(html).toContain('data:image/svg+xml');
    expect(html).not.toContain('contract.removed');
    expect(html).toContain('required=""');
  });

  test('empty clauses render a truthful count and read-only clauses hide clear controls', () => {
    expect(renderToStaticMarkup(<ClauseInitials clauses={[]} />)).toContain('0 of 0 initialed');
    const html = renderToStaticMarkup(<ClauseInitials clauses={[{ id: 'privacy', label: 'Privacy clause' }]} defaultValue={{ privacy: ink }} readOnly />);
    expect(html).toContain('1 of 1 initialed');
    expect(html).not.toContain('signature-pad-clear');
  });
});
