/** Shared-shell decision admission over synthetic domain receipts; no browser/app/database. */
import { afterEach, beforeEach, expect, test } from 'bun:test';
import type { ReactElement } from 'react';
import { ApiKeyConfirmationDialog, type PendingApiKeyConfirmation } from './api-key-management-parts';
import { ConfirmationDialog, type PendingConfirmation } from './tenant-member-management-parts';
import { OnboardingConfirmationDialog, type OnboardingConfirmation } from './tenant-onboarding-management-parts';
import { IntegrationSettingsConfirmationDialog } from '../integration-settings-list/integration-settings-confirmation';
import type { ModalDescriptor } from '../../modals/modal-system.types';
import { modals } from '../../modals/modal-events';
import { modalStore } from '../../modals/modal-store';
import { configureFrontendObservability } from '../../frontend/client/observability';

beforeEach(() => { configureFrontendObservability({ http: false, console: false }); modals.discardAll(); });
afterEach(() => modals.discardAll());
type Factory = (onConfirm: () => Promise<boolean>) => ReactElement;
const apiKey: PendingApiKeyConfirmation = { action: 'revoke', apiKey: {
  keyId: 'synthetic-key', userId: 'synthetic-user', label: 'Synthetic key', hint: '0000',
  scopeKind: 'application', scopeId: 'synthetic-app', tenantId: null, membershipId: null,
  createdByUserId: 'synthetic-user', createdVia: 'self', createdAt: 1, expiresAt: 2,
  lastUsedAt: null, revokedAt: null, status: 'active',
} };
const member = { action: 'remove', member: { membershipId: 'synthetic-member',
  identity: { firstName: 'Synthetic', lastName: 'Member', username: 'synthetic' } } } as PendingConfirmation;
const invitation = { action: 'revoke-invitation', invitation: { invitationId: 'synthetic-invitation', email: 'synthetic@example.test' } } as OnboardingConfirmation;
const factories: readonly [string, Factory][] = [
  ['API key', onConfirm => ApiKeyConfirmationDialog({ confirmation: apiKey, busy: false, error: null, onConfirm, onOpenChange() {}, onCloseAutoFocus() {} })],
  ['tenant member', onConfirm => ConfirmationDialog({ confirmation: member, tenantSingular: 'organization', busy: false, error: null,
    onConfirm, onOpenChange() {}, onCloseAutoFocus() {} })],
  ['onboarding', onConfirm => OnboardingConfirmationDialog({ confirmation: invitation, busy: false, error: null,
    onConfirm, onOpenChange() {}, onCloseAutoFocus() {} })],
  ['integration', onConfirm => IntegrationSettingsConfirmationDialog({ item: { id: 'synthetic', title: 'Synthetic integration' },
    action: { id: 'remove', label: 'Remove', destructive: true, onSelect() {} }, pending: false, error: null,
    onConfirm, onClose() {}, onCloseAutoFocus() {} })!],
];
function descriptor(element: ReactElement): ModalDescriptor<boolean> {
  return (element as ReactElement<{ descriptor: ModalDescriptor<boolean> }>).props.descriptor;
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }

for (const [name, factory] of factories) {
  test(`${name} shared decision accepts only an acknowledged current writer and cannot close or repeat while pending`, async () => {
    const receipt = deferred<boolean>(); let writes = 0, notifications = 0;
    const d = descriptor(factory(() => { writes++; return receipt.promise; }));
    const handle = modals.show({ ...d, onClose() { notifications++; } });
    const pending = modals.performAction(handle.id, 'confirm');
    expect(writes).toBe(1); expect(await modals.performAction(handle.id, 'confirm')).toBe(false);
    expect(await handle.dismiss('escape')).toBe(false); expect(notifications).toBe(0);
    receipt.resolve(true); expect(await pending).toBe(true);
    expect(await handle.result).toEqual({ kind: 'accepted', value: true }); expect(notifications).toBe(1);
    expect(modalStore.getSnapshot().context.closingIds).toContain(handle.id);
  });
  test(`${name} rejected or retired decision never reports accepted work`, async () => {
    const rejected = modals.show(descriptor(factory(async () => false)));
    expect(await modals.performAction(rejected.id, 'confirm')).toBe(false);
    expect(modalStore.getSnapshot().context.closingIds).not.toContain(rejected.id);
    const receipt = deferred<boolean>(); let notifications = 0;
    const handle = modals.show({ ...descriptor(factory(() => receipt.promise)), onClose() { notifications++; } });
    const pending = modals.performAction(handle.id, 'confirm'); modals.disposeHost([handle.id]); receipt.resolve(true);
    expect(await pending).toBe(false); expect(await handle.result).toEqual({ kind: 'retired' }); expect(notifications).toBe(0);
  });
}
