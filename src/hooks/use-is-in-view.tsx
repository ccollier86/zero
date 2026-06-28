'use client';

/**
 * use-is-in-view.tsx
 *
 * Wraps Motion's in-view observer with Zero's animation defaults. This file
 * owns viewport visibility state only.
 */

import * as React from 'react';
import { useInView, type UseInViewOptions } from 'motion/react';

export interface UseIsInViewOptions {
  inView?: boolean;
  inViewOnce?: boolean;
  inViewMargin?: UseInViewOptions['margin'];
}

/**
 * Return a local ref and whether the attached element should be treated as in view.
 */
function useIsInView<T extends HTMLElement = HTMLElement>(
  ref: React.Ref<T>,
  options: UseIsInViewOptions = {},
) {
  const { inView, inViewOnce = false, inViewMargin = '0px' } = options;
  const localRef = React.useRef<T>(null);
  React.useImperativeHandle(ref, () => localRef.current as T);
  const inViewResult = useInView(localRef, {
    once: inViewOnce,
    margin: inViewMargin,
  });
  const isInView = !inView || inViewResult;
  return { ref: localRef, isInView };
}

export { useIsInView };
