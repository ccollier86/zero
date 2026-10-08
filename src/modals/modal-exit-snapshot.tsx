'use client';

/** Capture paint before React retires the interactive Radix subtree on logical close. */
import * as React from 'react';
import { captureModalVisualState } from './modal-motion-animation';

export interface ModalExitPaint {
  readonly element: HTMLDivElement;
  readonly visual: ReturnType<typeof captureModalVisualState>;
  readonly innerVisual: ReturnType<typeof captureModalVisualState> | null;
}
interface Props {
  readonly closing: boolean;
  readonly element: React.RefObject<HTMLDivElement | null>;
  readonly onCapture: (paint: ModalExitPaint) => void;
  readonly children: React.ReactNode;
}

/** getSnapshotBeforeUpdate runs before DOM removal; effects are too late for this measurement. */
export class ModalExitSnapshot extends React.Component<Props> {
  getSnapshotBeforeUpdate(previous: Props): null {
    const shell = this.props.element.current;
    if (!previous.closing && this.props.closing && shell) {
      const element = shell.cloneNode(true) as HTMLDivElement;
      element.inert = true; element.setAttribute('aria-hidden', 'true'); element.removeAttribute('role');
      element.removeAttribute('data-zero-modal-id'); element.style.pointerEvents = 'none';
      // Exit paint must not make another retained DOM copy of revealed secrets.
      // PasswordInput marks its revealed text form explicitly; autocomplete also
      // covers app-owned password/OTP inputs that use the ordinary Input facade.
      for (const field of element.querySelectorAll<HTMLElement>(
        'input[type="password"], [data-zero-sensitive], input[autocomplete~="current-password" i], input[autocomplete~="new-password" i], input[autocomplete~="one-time-code" i]')) {
        if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
          field.value = ''; field.defaultValue = ''; field.removeAttribute('value');
        }
        else field.textContent = '';
      }
      for (const field of element.querySelectorAll('[data-slot="secret-field-value"]')) field.textContent = '••••••••';
      // cloneNode does not preserve a canvas bitmap; copy paint only, never serialize or log it.
      const originalCanvases = shell.querySelectorAll('canvas'), paintedCanvases = element.querySelectorAll('canvas');
      originalCanvases.forEach((canvas, index) => {
        try { paintedCanvases[index]?.getContext('2d')?.drawImage(canvas, 0, 0); }
        catch { /* A unavailable/cross-origin canvas must not block dismissal. */ }
      });
      for (const node of [element, ...element.querySelectorAll<HTMLElement>('[id]')]) node.removeAttribute('id');
      const inner = shell.querySelector<HTMLElement>('[data-zero-modal-inner]');
      this.props.onCapture({ element, visual: captureModalVisualState(shell), innerVisual: inner ? captureModalVisualState(inner) : null });
    }
    return null;
  }
  componentDidUpdate(): void { /* Snapshot is consumed by the new paint-host ref during this commit. */ }
  render(): React.ReactNode { return this.props.children; }
}
