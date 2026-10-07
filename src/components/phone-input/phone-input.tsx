'use client';

/** ReUI-inspired phone presentation with Zero controls; upstream owns formatting and the shared helper owns validation. */
import { forwardRef, useEffect, useRef, useState, type ForwardRefExoticComponent, type RefAttributes, type InputHTMLAttributes, type FocusEvent } from 'react';
import * as BasePhoneInput from 'react-phone-number-input';
import { cn } from '#zero/lib/utils';
import { isPhoneNumber } from '../../lib/phone-number';
import { PhoneInputContext } from './phone-input-context';
import { PhoneInputCountry } from './phone-input-country';
import { PhoneInputNative } from './phone-input-native';
import { PhoneInputFlag } from './phone-input-flag';
import type { PhoneInputProps } from './phone-input.types';

// Upstream runtime forwards to the native input, while its declaration types the legacy class wrapper.
const UpstreamPhoneInput = BasePhoneInput.default as unknown as ForwardRefExoticComponent<BasePhoneInput.Props<InputHTMLAttributes<HTMLInputElement>> & RefAttributes<HTMLInputElement>>;

/** Read-only is focusable/submittable; disabled is not. Native submission uses one canonical named hidden field. */
export const PhoneInput = forwardRef<HTMLInputElement, PhoneInputProps>(function PhoneInput(props, forwardedRef) {
  const { value, defaultValue = '', onChange, name, defaultCountry = 'US', countries, onCountryChange, labels,
    className, inputClassName, variant = 'default', popupClassName, scrollAreaClassName,
    validation = 'possible', readOnly = false, disabled = false, onBlur, autoComplete = 'tel', ...native } = props;
  const controlled = Object.prototype.hasOwnProperty.call(props, 'value');
  const [localValue, setLocalValue] = useState(defaultValue), [blurred, setBlurred] = useState(false), [resetRevision, setResetRevision] = useState(0);
  const currentValue = controlled ? value ?? '' : localValue;
  const input = useRef<HTMLInputElement | null>(null), rawDraft = useRef('');
  const priorValue = useRef(currentValue);
  const interaction = useRef({ readOnly, disabled }); interaction.current = { readOnly, disabled };
  const invalidNumber = !!currentValue && !isPhoneNumber(currentValue, validation);
  const invalid = native['aria-invalid'] ?? (blurred && invalidNumber ? true : undefined);
  useEffect(() => {
    input.current?.setCustomValidity(invalidNumber ? 'Enter a valid phone number including its country code.' : '');
  }, [invalidNumber, resetRevision]);
  useEffect(() => {
    // Both '+' and '' map to upstream undefined. An explicit external clear still
    // needs to retire its private phoneDigits; ordinary typed clears keep focus.
    if (currentValue === '' && priorValue.current !== '' && input.current?.value) {
      rawDraft.current = ''; setResetRevision(revision => revision + 1);
    }
    priorValue.current = currentValue;
  }, [currentValue]);
  useEffect(() => {
    const form = input.current?.form;
    if (controlled || !form) return;
    const reset = (event: Event) => queueMicrotask(() => {
      if (event.defaultPrevented) return;
      rawDraft.current = ''; setLocalValue(defaultValue); setBlurred(false);
      // A public native form reset restores both the initial number and upstream country state.
      setResetRevision(revision => revision + 1);
    });
    form.addEventListener('reset', reset);
    return () => form.removeEventListener('reset', reset);
  }, [controlled, defaultValue, native.form]);
  function change(next?: BasePhoneInput.Value) {
    if (interaction.current.readOnly || interaction.current.disabled) return;
    // Upstream can emit undefined for a nonempty '+' draft. That must not become an optional SQL absence.
    const visibleDraft = input.current?.value ?? rawDraft.current;
    const draft = next ?? (visibleDraft.trim() ? visibleDraft : '');
    if (!controlled) setLocalValue(draft);
    onChange?.(draft);
  }
  return <PhoneInputContext.Provider value={{ variant, popupClassName, scrollAreaClassName, inputClassName,
    readOnly, disabled, invalid, interaction, rawDraft }}>
    <div data-slot="phone-input" data-size={variant} data-readonly={readOnly || undefined} data-disabled={disabled || undefined} className={cn('flex w-full min-w-0 items-center', className)}>
      <UpstreamPhoneInput key={resetRevision} {...native} autoComplete={autoComplete} readOnly={readOnly} disabled={disabled}
        className="flex w-full min-w-0 items-center" defaultCountry={defaultCountry}
        countries={countries ? [...countries] : undefined} labels={labels} smartCaret={false}
        flagComponent={({ country, countryName }) => <PhoneInputFlag country={country} title={countryName} />}
        countrySelectComponent={PhoneInputCountry} inputComponent={PhoneInputNative}
        value={/^\+[1-9]\d*$/u.test(currentValue) ? currentValue : undefined} onChange={change}
        onCountryChange={country => {
          if (!interaction.current.readOnly && !interaction.current.disabled) onCountryChange?.(country);
        }}
        onBlur={event => { setBlurred(true); onBlur?.(event as FocusEvent<HTMLInputElement>); }}
        ref={element => {
          input.current = element;
          if (typeof forwardedRef === 'function') forwardedRef(element);
          else if (forwardedRef) forwardedRef.current = element;
        }} />
      {name && <input type="hidden" name={name} value={currentValue} disabled={disabled} form={native.form} />}
    </div>
  </PhoneInputContext.Provider>;
});
