/** Checks configured confirmation labels without mounting an application runtime. */

import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConfirmModalContent } from './confirm-modal';
import type { ModalInstance } from './modal.types';

function markup(holdToConfirm: boolean, confirmLabel?: string): string {
  const modal: ModalInstance = {
    id: 'synthetic-confirm', type: 'confirm',
    confirmOptions: { title: 'Synthetic action', holdToConfirm, confirmLabel },
  };
  return renderToStaticMarkup(<ConfirmModalContent modal={modal} onResult={() => {}} />);
}

describe('ConfirmModalContent action labels', () => {
  test('uses the configured confirm label for both normal and held actions', () => {
    expect(markup(false, 'Archive selected')).toContain('Archive selected');
    expect(markup(true, 'Archive selected')).toContain('Archive selected');
  });

  test('retains standard defaults when no confirm label is supplied', () => {
    expect(markup(false)).toContain('Confirm');
    expect(markup(true)).toContain('Hold to Confirm');
  });
});
