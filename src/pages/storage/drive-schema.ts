/**
 * drive-schema.ts
 *
 * Compatibility wrapper for storage drive schema metadata. New imports should
 * use src/components/storage or @zero/framework/react component exports.
 */

export {
  storageDriveEditableFields as driveEditableFields,
  storageDriveListColumns as driveListColumns,
  storageDriveSchema as driveSchema,
} from '../../components/storage';
