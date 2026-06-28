/**
 * storage-drive-schema.ts
 *
 * Defines schema metadata for the storage drive management UI. This file owns
 * form/list field descriptions only; drive persistence stays in storage hooks.
 */

import { defineSchema, field } from '../../schema';

/** Schema used by the storage drive master-detail editor. */
export const storageDriveSchema = defineSchema({
  name: field.text({ label: 'Name', required: true, placeholder: 'My Drive' }),
  max_size_bytes: field.number({ label: 'Max Size (bytes)', placeholder: '0 = unlimited' }),
  max_file_size_bytes: field.number({ label: 'Max File Size (bytes)', placeholder: '0 = unlimited' }),
  allowed_mime_types: field.text({ label: 'Allowed MIME Types', placeholder: '* (all)' }),
  public: field.select(
    [
      { value: '1', label: 'Public' },
      { value: '0', label: 'Private' },
    ],
    { label: 'Visibility', defaultValue: '0' },
  ),
});

/** Drive fields shown in the list panel. */
export const storageDriveListColumns = ['name', 'allowed_mime_types', 'public'];

/** Drive fields editable in the detail panel. */
export const storageDriveEditableFields = [
  'name',
  'max_size_bytes',
  'max_file_size_bytes',
  'allowed_mime_types',
  'public',
];
