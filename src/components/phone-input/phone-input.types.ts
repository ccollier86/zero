/** Public presentation/native form contract; formatting and numbering metadata belong to the upstream engine. */
import type { InputHTMLAttributes } from 'react';
import type { Country, Labels } from 'react-phone-number-input';
import type { PhoneNumberValidation } from '../../lib/phone-number';

export type PhoneInputSize = 'sm' | 'default' | 'lg';
/** Emits upstream E.164 drafts (including incomplete numbers), or '' only for an empty input. */
export interface PhoneInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'defaultValue' | 'onChange' | 'size' | 'type'> {
  value?: string | null;
  defaultValue?: string;
  onChange?: (value: string) => void;
  /** Initial national-number interpretation; a prefilled international number still owns its inferred country. */
  defaultCountry?: Country;
  countries?: readonly Country[];
  onCountryChange?: (country: Country | undefined) => void;
  labels?: Labels;
  variant?: PhoneInputSize;
  popupClassName?: string;
  scrollAreaClassName?: string;
  inputClassName?: string;
  /** Number validation is independent of formatting; neither mode proves reachability. */
  validation?: PhoneNumberValidation;
}
