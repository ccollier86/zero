/** SSR verifies default-country/native read-only and canonical named form fields using only public component inputs. */
import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { PhoneInput } from './phone-input';

describe('PhoneInput server representation', () => {
  test('uses US default and preserves visible native id/ARIA/name in one hidden canonical field', () => {
    const html = renderToString(createElement(PhoneInput, { id: 'phone', name: 'phone', required: true, 'aria-describedby': 'help' }));
    expect(html).toContain('United States'); expect(html).toContain('id="phone"'); expect(html).toContain('type="tel"');
    expect(html).toContain('aria-describedby="help"'); expect(html).toContain('required=""');
    expect(html.match(/name="phone"/gu)).toHaveLength(1); expect(html).toContain('type="hidden" name="phone"');
  });
  test('read-only is static but focusable/submittable, unlike disabled', () => {
    const readonly = renderToString(createElement(PhoneInput, { readOnly: true, value: '+33612345678', name: 'phone', defaultCountry: 'US' }));
    expect(readonly).toContain('phone-input-country-readonly'); expect(readonly).toContain('France');
    expect(readonly).toContain('readOnly=""'); expect(readonly).not.toContain('disabled=""');
    expect(readonly).toContain('value="+33612345678"'); expect(readonly).not.toContain('phone-input-country"');
    const disabled = renderToString(createElement(PhoneInput, { disabled: true, value: '+12025550123', name: 'phone' }));
    expect(disabled).toContain('disabled=""');
  });
  test('FR default and invalid ARIA remain explicit public presentation choices', () => {
    const html = renderToString(createElement(PhoneInput, { defaultCountry: 'FR', 'aria-invalid': true, variant: 'sm' }));
    expect(html).toContain('France'); expect(html).toContain('data-size="sm"'); expect(html).toContain('aria-invalid="true"');
  });
});
