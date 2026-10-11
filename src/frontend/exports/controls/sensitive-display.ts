/** Masked secret, phone and regional-number controls. Curated client-safe re-exports only; implementation/context ownership stays with the existing modules. */

export { SecretField } from '../../../components/secret-field';
export type { SecretFieldProps } from '../../../components/secret-field';
export { PhoneInput } from '../../../components/phone-input';
export type { PhoneInputProps, PhoneInputSize } from '../../../components/phone-input';
export { isPhoneNumber, isPhoneCountry } from '../../../lib/phone-number';
export type { PhoneCountry, PhoneNumberValidation } from '../../../lib/phone-number';
