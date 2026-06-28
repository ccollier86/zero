'use client';

/**
 * use-data-state.tsx
 *
 * Watches a DOM `data-*` attribute through `MutationObserver`. This file owns
 * DOM attribute subscription state only.
 */

import * as React from 'react';

export type DataStateValue = string | boolean | null;

function parseDatasetValue(value: string | null): DataStateValue {
  if (value === null) return null;
  if (value === '' || value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

/**
 * Return the current parsed `data-${key}` value for the attached element.
 *
 * The returned ref must be assigned to the element whose data attribute should
 * be observed.
 */
function useDataState<T extends HTMLElement = HTMLElement>(
  key: string,
  forwardedRef?: React.Ref<T | null>,
  onChange?: (value: DataStateValue) => void,
): [DataStateValue, React.RefObject<T | null>] {
  const localRef = React.useRef<T | null>(null);
  React.useImperativeHandle(forwardedRef, () => localRef.current as T);

  const getSnapshot = (): DataStateValue => {
    const el = localRef.current;
    return el ? parseDatasetValue(el.getAttribute(`data-${key}`)) : null;
  };

  const subscribe = (callback: () => void) => {
    const el = localRef.current;
    if (!el) return () => {};
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.attributeName === `data-${key}`) {
          callback();
          break;
        }
      }
    });
    observer.observe(el, {
      attributes: true,
      attributeFilter: [`data-${key}`],
    });
    return () => observer.disconnect();
  };

  const value = React.useSyncExternalStore(subscribe, getSnapshot);

  React.useEffect(() => {
    if (onChange) onChange(value);
  }, [value, onChange]);

  return [value, localRef];
}

export { useDataState };
