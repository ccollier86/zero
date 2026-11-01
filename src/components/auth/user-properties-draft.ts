/**
 * Typed property-form baselines and drafts. Missing optional values are display
 * defaults, not writes. This model has no transport, React or authorization.
 */
import type { AuthUserPropertyConfig } from '../../frontend/client/auth-types';

export type PropertyFormValue = string | number | boolean;
export interface PropertyDraftWrite { readonly key: string; readonly value: PropertyFormValue }
interface FieldDraft { field: AuthUserPropertyConfig; baseline: PropertyFormValue; value: PropertyFormValue; pending: boolean }

/** Semantic schema identity; labels or unrelated auth config do not retire edits. */
export function propertyFormSchema(fields: readonly AuthUserPropertyConfig[]): string {
  return JSON.stringify([...fields].sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
    .map(field => [field.key, field.type, field.values ? [...field.values].sort() : null, field.default ?? null, field.editableBy]));
}

/** Local draft owner for one account, client and authorization generation. */
export class UserPropertiesDraft {
  private readonly fields = new Map<string, FieldDraft>();

  /** Merge fresh accepted state without erasing dirty or in-flight user input. */
  reconcile(fields: readonly AuthUserPropertyConfig[], properties: Readonly<Record<string, string>>): void {
    const keys = new Set(fields.filter(field => field.editableBy === 'user').map(field => field.key));
    for (const key of this.fields.keys()) if (!keys.has(key)) this.fields.delete(key);
    for (const field of fields) {
      if (!keys.has(field.key)) continue;
      const baseline = propertyFormValue(field, properties[field.key] ?? field.default);
      const previous = this.fields.get(field.key);
      if (!previous || previous.field.type !== field.type) {
        this.fields.set(field.key, { field, baseline, value: baseline, pending: false });
      } else {
        const clean = Object.is(previous.value, previous.baseline);
        if (clean && !previous.pending) previous.value = baseline;
        previous.baseline = baseline;
        previous.field = field;
      }
    }
  }

  /** Read the current display value, never materializing it in persistence. */
  value(key: string): PropertyFormValue | undefined { return this.fields.get(key)?.value; }
  /** Accept typing even while an earlier submitted value awaits acknowledgment. */
  edit(key: string, value: PropertyFormValue): void {
    const field = this.fields.get(key);
    if (field) field.value = value;
  }
  /** Capture only genuinely changed, currently self-editable fields. */
  changes(): PropertyDraftWrite[] {
    return [...this.fields].filter(([, field]) => !Object.is(field.value, field.baseline))
      .map(([key, field]) => {
        if (field.field.type === 'number' && (field.value === '' || !Number.isFinite(Number(field.value)))) {
          throw new Error('Enter a finite number for each changed number setting.');
        }
        if (field.field.type === 'enum' && !field.field.values?.includes(String(field.value))) {
          throw new Error('Choose a currently available option for each changed selection.');
        }
        return { key, value: field.value };
      });
  }
  get dirty(): boolean { return [...this.fields.values()].some(field => !Object.is(field.value, field.baseline)); }
  /** Protect a submitted snapshot from incidental property-store refreshes. */
  begin(writes: readonly PropertyDraftWrite[]): void {
    for (const write of writes) { const field = this.fields.get(write.key); if (field) field.pending = true; }
  }
  /** Preserve typing while an explicit read checks an uncertain operation. */
  hold(): void { for (const field of this.fields.values()) field.pending = true; }
  /** Advance only the acknowledged baseline, preserving any newer/reverted typing. */
  accept(write: PropertyDraftWrite): void {
    const field = this.fields.get(write.key);
    if (field) { field.baseline = write.value; field.pending = false; }
  }
  /** Retire an attempt without claiming rollback or acceptance of unresolved fields. */
  finish(): void { for (const field of this.fields.values()) field.pending = false; }
}

/** Normalize persisted strings to the type shown by the configured field control. */
export function propertyFormValue(field: AuthUserPropertyConfig, raw: unknown): PropertyFormValue {
  if (raw === undefined || raw === null) return field.type === 'boolean' ? false : '';
  if (field.type === 'boolean') return raw === true || raw === 'true';
  if (field.type === 'number') return raw === '' ? '' : Number.isFinite(Number(raw)) ? Number(raw) : String(raw);
  return String(raw);
}
