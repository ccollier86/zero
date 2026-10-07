/** Shares presentation and the current interaction fence between the upstream country and input adapters. */
import { createContext, useContext, type MutableRefObject } from 'react';
import type { PhoneInputSize } from './phone-input.types';

interface PhoneInputPresentation {
  readonly variant: PhoneInputSize;
  readonly popupClassName?: string;
  readonly scrollAreaClassName?: string;
  readonly inputClassName?: string;
  readonly readOnly: boolean;
  readonly disabled: boolean;
  readonly invalid?: boolean | 'true' | 'false' | 'grammar' | 'spelling';
  readonly interaction: MutableRefObject<{ readOnly: boolean; disabled: boolean }>;
  readonly rawDraft: MutableRefObject<string>;
}
export const PhoneInputContext = createContext<PhoneInputPresentation | null>(null);
/** The adapters are private; their parent owns native value and callback semantics. */
export function usePhoneInputPresentation(): PhoneInputPresentation {
  const context = useContext(PhoneInputContext);
  if (!context) throw new Error('PhoneInput adapters require their parent presentation.');
  return context;
}
