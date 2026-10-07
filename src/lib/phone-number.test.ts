/** Synthetic numbering-plan checks; no delivery, identity verification or external services. */
import { expect, test } from 'bun:test';
import { isPhoneCountry, isPhoneNumber } from './phone-number';

test('canonical international phone values admit country/length without guessing a country', () => {
  for (const value of ['+12135550123', '+442079460123', '+33142685300']) {
    expect(isPhoneNumber(value)).toBe(true);
    expect(isPhoneNumber(value, 'valid')).toBe(true);
  }
  for (const value of [undefined, null, 12135550123, '', '+', '+12', '2135550123', '(213) 555-0123', '+1 2135550123', ' +12135550123', '+12135550123\n', '+12135550123 ext. 12', '+01235550123', '+999123456789', '+' + '1'.repeat(16), '+１２１３５５５０１２３']) {
    expect(isPhoneNumber(value)).toBe(false);
  }
});

test('possible and valid have deliberate different numbering-plan strictness', () => {
  expect(isPhoneNumber('+12005550123', 'possible')).toBe(true);
  expect(isPhoneNumber('+12005550123', 'valid')).toBe(false);
  expect(isPhoneNumber('+12135550123', 'unknown' as never)).toBe(false);
});

test('country selectors use the supported country set rather than arbitrary two-letter strings', () => {
  expect(isPhoneCountry('US')).toBe(true);
  expect(isPhoneCountry('GB')).toBe(true);
  for (const value of ['us', 'USA', 'XX', '', null, 1]) expect(isPhoneCountry(value)).toBe(false);
});
