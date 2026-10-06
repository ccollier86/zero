import { expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { StorageDriveRow } from './storage-management-types';
import { StorageDriveSettingsPanel } from './storage-drive-settings-panel';

test('drive settings explain disabled public policy without offering a usable publishing control', () => {
  const blocked = renderToStaticMarkup(createElement(StorageDriveSettingsPanel, {
    drive: drive(),
    allowPublicVisibility: false,
    onSave: () => undefined,
  }));
  const allowed = renderToStaticMarkup(createElement(StorageDriveSettingsPanel, {
    drive: drive(),
    allowPublicVisibility: true,
    onSave: () => undefined,
  }));

  expect(blocked).toContain('aria-label="Drive visibility"');
  expect(blocked).toContain('Public access is disabled by policy');
  expect(blocked).toContain('disabled=""');
  expect(allowed).toContain('aria-label="Drive visibility"');
});

test('public drive settings describe inherited downloads for existing and future files', () => {
  const markup = renderToStaticMarkup(createElement(StorageDriveSettingsPanel, {
    drive: { ...drive(), public: 1 }, onSave: () => undefined,
  }));
  expect(markup).toContain('Anyone with a file URL can download it.');
  expect(markup).toContain('all existing and future files');
});

test('an existing public drive can still be made private after policy is tightened', () => {
  const publicDrive = { ...drive(), public: 1 };
  const markup = renderToStaticMarkup(createElement(StorageDriveSettingsPanel, {
    drive: publicDrive,
    allowPublicVisibility: false,
    onSave: () => undefined,
  }));

  expect(markup).toContain('aria-label="Drive visibility"');
  expect(markup).toContain('Public access is disabled by policy');
});

function drive(): StorageDriveRow {
  return {
    id: 'drive-one',
    name: 'Documents',
    owner_id: 'user-one',
    max_size_bytes: 1_024,
    max_file_size_bytes: 512,
    allowed_mime_types: '*',
    public: 0,
    access: {
      effectiveAccess: 'admin',
      canRead: true,
      canWrite: true,
      canAdmin: true,
      isOwner: true,
      isPlatformAdmin: false,
      isPublic: false,
    },
  };
}
