/** Form composition and accepted-save hooks. Curated client-safe re-exports only; implementation/context ownership stays with the existing modules. */

// ─── Forms ──────────────────────────────────────────────────────────────
export { AutoForm } from '../../../components/forms';
export { FieldRenderer } from '../../../components/forms';
export { Wizard } from '../../../components/forms';
export type { WizardProps, WizardStep } from '../../../components/forms';
export { useForm } from '../../../hooks/use-form';
export type { UseFormOptions, UseFormReturn } from '../../../hooks/use-form';
export { useFormSave } from '../../../hooks/use-form-save';
export type { UseFormSaveOptions, UseFormSaveReturn } from '../../../hooks/use-form-save';
export type { FormLeaveOptions } from '../../../hooks/use-form-save';
export { useReactiveFormRecord } from '../../../hooks/use-reactive-form-record';
export type { UseReactiveFormRecordOptions } from '../../../hooks/use-reactive-form-record';
export type * from '../../../hooks/form-save-types';
export { FormSaveBar, UnsavedChangesDialog } from '../../../components/form-save';
export type { FormSaveBarProps, UnsavedChangesDialogProps } from '../../../components/form-save';
