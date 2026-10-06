/** React composition options for SVG ink capture; storage and signing authority belong to the app. */
import type * as React from 'react';
import type { SignaturePadApi, SignaturePadFormat, SignaturePadPointerType, SignaturePadSizing, SignaturePadStroke } from './signature-pad.types';

/** Signature state can be parent-owned or local; callbacks receive immutable snapshots. */
export interface SignaturePadProps extends Omit<React.ComponentProps<'div'>, 'defaultValue' | 'onChange'> {
  value?: readonly SignaturePadStroke[];
  defaultValue?: readonly SignaturePadStroke[];
  onValueChange?: (value: readonly SignaturePadStroke[]) => void;
  onStrokeStart?: (details: { pointerType: SignaturePadPointerType }) => void;
  onStrokeEnd?: (stroke: SignaturePadStroke) => void;
  apiRef?: React.Ref<SignaturePadApi>;
  /** Change when the document/authorization boundary changes; late work is retired. */
  scopeKey?: string | number;
  color?: string;
  minWidth?: number;
  maxWidth?: number;
  smoothing?: number;
  sizing?: SignaturePadSizing;
  pointerTypes?: readonly SignaturePadPointerType[];
  disabled?: boolean;
  readOnly?: boolean;
  name?: string;
  form?: string;
  required?: boolean;
  format?: SignaturePadFormat;
}
