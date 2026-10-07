/** Synthetic SSR checks for the shared native input contract; no app/account is opened. */
import { expect, test } from 'bun:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Input } from './input';

test('readonly forwards native identity/value and is not converted into a disabled control', () => {
  const html = renderToStaticMarkup(<Input id="account-phone" name="phone" readOnly defaultValue="+12125551234" aria-label="Phone" />);
  expect(html).toContain('readOnly=""');
  expect(html).not.toContain('disabled=""');
  expect(html).toContain('name="phone"');
  expect(html).toContain('id="account-phone"');
  expect(html).toContain('value="+12125551234"');
  expect(html).toContain('data-readonly="true"');
  expect(html).toContain('cursor-default');
  expect(html).not.toContain('group-hover/input:shadow-none');
});

test('wrapper customization does not become a native attribute or change ordinary inputs', () => {
  const html = renderToStaticMarkup(<Input wrapperClassName="rounded-s-none" className="text-xs" defaultValue="Synthetic" />);
  expect(html).toContain('data-slot="input-wrapper"');
  expect(html).toContain('rounded-s-none');
  expect(html).toContain('text-xs');
  expect(html).not.toContain('wrapperClassName');
  expect(html).toContain('group-hover/input:shadow-none');
  expect(html).not.toContain('data-readonly');
});

test('hidden and disabled paths preserve native behavior without a hidden wrapper', () => {
  const html = renderToStaticMarkup(<Input type="hidden" name="phone" value="+12125551234" readOnly disabled wrapperClassName="not-for-hidden" />);
  expect(html).toContain('type="hidden"');
  expect(html).toContain('readOnly=""');
  expect(html).toContain('disabled=""');
  expect(html).not.toContain('<div');
  expect(html).not.toContain('input-wrapper');
  expect(html).not.toContain('not-for-hidden');
});
