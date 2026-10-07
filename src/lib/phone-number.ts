/** Headless canonical phone admission; formatting and verified ownership are separate concerns. */

import { getCountries, parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/max';

export type PhoneCountry = CountryCode;
export type PhoneNumberValidation = 'possible' | 'valid';

const countries = new Set<string>(getCountries());
const E164 = /^\+[1-9][0-9]{1,14}$/u;

/** Country selection metadata must name an actual supported two-letter country. */
export function isPhoneCountry(value: unknown): value is PhoneCountry {
  return typeof value === 'string' && countries.has(value);
}

/**
 * Accept only canonical international strings. `possible` checks country/length;
 * `valid` additionally checks current numbering-plan patterns. Neither proves
 * reachability, ownership or permission to contact a number. National input is
 * deliberately not normalized here: a UI's default country is presentation only.
 */
export function isPhoneNumber(
  value: unknown,
  validation: PhoneNumberValidation = 'possible',
): value is string {
  if (typeof value !== 'string' || value.length > 16 || !E164.test(value)) return false;
  if (validation !== 'possible' && validation !== 'valid') return false;
  const parsed = parsePhoneNumberFromString(value);
  return Boolean(parsed && parsed.number === value
    && (validation === 'valid' ? parsed.isValid() : parsed.isPossible()));
}
