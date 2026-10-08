'use client';

/**
 * Binds caller-owned authorized reactive record snapshots to useForm's atomic
 * baseline admission. No transport, subscriptions, deletion inference, or merge policy.
 */
import { useEffect, useRef } from 'react';
import type { Row } from '../sync/types';
import type { UseFormReturn } from './use-form';
import type { FormRecordSnapshot } from './form-save-types';
import { copyFormValue } from './form-acceptance-controller';
import { areFormValuesEqual } from './form-value-utils';

/** The source must supply authoritative readiness/revision, and form.recordIdentity must match it. */
export interface UseReactiveFormRecordOptions<T extends Row = Row> {
  readonly form: Pick<UseFormReturn<T>, 'boundaryKey' | 'reconcileRecord' | 'reloadRecord' | 'recordState' | 'incomingRecord'>;
  readonly record: FormRecordSnapshot<T>;
}

/** Pristine changes adopt; dirty changes retain the draft until reload is explicitly admitted. */
export function useReactiveFormRecord<T extends Row = Row>({ form, record }: UseReactiveFormRecordOptions<T>) {
  const reconcile = form.reconcileRecord;
  const seen = useRef<{ readonly boundaryKey: string; readonly record: FormRecordSnapshot<T> } | null>(null);
  useEffect(() => {
    // A caller often creates the source descriptor inline. Re-running the old
    // snapshot after a newer save acknowledgment would incorrectly roll its
    // canonical baseline/revision back while the subscription catches up.
    if (seen.current?.boundaryKey === form.boundaryKey && areFormValuesEqual(seen.current.record, record)) return;
    const result = reconcile(record);
    if (result.kind !== 'ignored' || result.reason === 'pending-local') seen.current = {
      boundaryKey: form.boundaryKey, record: copyFormValue(record),
    };
  }, [form.boundaryKey, record, reconcile]);
  return { ...form.recordState, incomingRecord: form.incomingRecord, reload: form.reloadRecord };
}
