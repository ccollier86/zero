'use client';

/** Signature view/interaction contexts shared by the drawing surface and existing Zero controls. */
import * as React from 'react';
import type { SignaturePadApi, SignaturePadFormat, SignaturePadPointerType, SignaturePadSizing, SignaturePadStroke } from './signature-pad.types';

export interface SignaturePadConfig {
  epoch: object;
  color?: string;
  minWidth: number;
  maxWidth: number;
  smoothing: number;
  sizing: SignaturePadSizing;
  pointerTypes?: readonly SignaturePadPointerType[];
  name?: string;
  form?: string;
  required: boolean;
  format: SignaturePadFormat;
  interactive: boolean;
  busy: boolean;
  invalid: boolean;
  fieldId: string;
  errorId: string;
  setInvalid: (invalid: boolean) => void;
  setArea: (node: HTMLDivElement | null) => void;
  setDrawing: (drawing: boolean) => void;
  commitStroke: (stroke: SignaturePadStroke) => void;
  notifyStrokeStart: (details: { pointerType: SignaturePadPointerType }) => boolean;
  lockInteractions: () => () => void;
}

export const SignaturePadContext = React.createContext<SignaturePadApi | null>(null);
export const SignaturePadConfigContext = React.createContext<SignaturePadConfig | null>(null);

/** Read the live pad API inside its provider; apiRef supports outside toolbars/form handlers. */
export function useSignaturePad(): SignaturePadApi {
  const value = React.useContext(SignaturePadContext);
  if (!value) throw new Error('useSignaturePad must be used within <SignaturePad>.');
  return value;
}

export function useSignaturePadConfig(part: string): SignaturePadConfig {
  const value = React.useContext(SignaturePadConfigContext);
  if (!value) throw new Error(`${part} must be used within <SignaturePad>.`);
  return value;
}
