/** Decision-only storage dialogs never strand promise waiters during scope retirement. */
import { afterEach, describe, expect, test } from 'bun:test';
import { modals } from '../../modals/modal-events';
import { modalStore } from '../../modals/modal-store';
import { openStorageNameDialog } from './storage-name-dialog';
import { openStorageStudioProvisionDialog } from './storage-studio-provision-dialog';
import type { StorageStudioCapabilities } from '../../storage/storage-studio-contracts';
afterEach(() => modals.discardAll());
describe('storage modal settlement', () => {
  test('name prompt has one standard footer and resolves null on scope retirement', async () => {
    const result = openStorageNameDialog({ title: 'Rename file', label: 'Name', initialValue: 'report.txt' });
    const modal = modalStore.getSnapshot().context.modals.at(-1)!;
    expect(modal.descriptor?.title).toBe('Rename file'); expect(modal.descriptor?.actions).toHaveLength(2);
    modals.discardAll(); expect(await result).toBeNull();
  });
  test('name prompt trims accepted values and rejects an empty required submission', async () => {
    const result = openStorageNameDialog({ title: 'Name', label: 'Name', initialValue: '   ' });
    const modal = modalStore.getSnapshot().context.modals.at(-1)!;
    expect(await modals.performAction(modal.id, 'submit')).toBe(false);
    expect(modalStore.getSnapshot().context.modals.at(-1)?.systemState?.error).toBe('Enter a value.');
    modals.disposeHost([modal.id]); expect(await result).toBeNull();
  });
  test('provision draft uses typed decision result and resolves null on authoritative disposal', async () => {
    const result = openStorageStudioProvisionDialog({} as StorageStudioCapabilities);
    const modal = modalStore.getSnapshot().context.modals.at(-1)!;
    expect(modal.descriptor?.actions?.[1]?.label).toBe('Create drive');
    expect(modal.descriptor?.actions?.[1]?.disabled).toBe(true);
    modals.disposeHost([modal.id]); expect(await result).toBeNull();
  });
});
