'use client';

/**
 * use-controlled-state.tsx
 *
 * Normalizes controlled and uncontrolled component state. This file owns local
 * state coordination only; callers own validation and persistence.
 */

import * as React from 'react';

export interface CommonControlledStateProps<T> {
  value?: T;
  defaultValue?: T;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
/**
 * Return a value/setter pair that supports both controlled and uncontrolled use.
 *
 * The setter updates internal state and forwards the change to `onChange`.
 */
export function useControlledState<T, Rest extends any[] = []>(
  props: CommonControlledStateProps<T> & {
    onChange?: (value: T, ...args: Rest) => void;
  },
): readonly [T, (next: T, ...args: Rest) => void] {
  const { value, defaultValue, onChange } = props;

  const [state, setInternalState] = React.useState<T>(
    value !== undefined ? value : (defaultValue as T),
  );

  React.useEffect(() => {
    if (value !== undefined) setInternalState(value);
  }, [value]);

  const setState = React.useCallback(
    (next: T, ...args: Rest) => {
      setInternalState(next);
      onChange?.(next, ...args);
    },
    [onChange],
  );

  // A controlled change is a request: the parent remains authoritative until
  // it commits a new value. Local state is only the uncontrolled fallback.
  return [value !== undefined ? value : state, setState] as const;
}
