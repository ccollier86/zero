import { defineSchema, field } from '../../schema';

export const driveSchema = defineSchema({
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

export const driveListColumns = ['name', 'allowed_mime_types', 'public'];

export const driveEditableFields = ['name', 'max_size_bytes', 'max_file_size_bytes', 'allowed_mime_types', 'public'];
