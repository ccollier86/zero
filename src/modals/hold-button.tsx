'use client';

/** Owns deliberate hold confirmation; callbacks never outlive a cancelled hold. */

import { useState, useRef, useCallback, useEffect } from 'react';
import { Trash2 } from 'lucide-react';
import { cn } from '#zero/lib/utils';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface HoldButtonProps {
  /** Callback when hold completes */
  onConfirm: () => void;
  /** Positive finite hold duration in ms. Default: 1500. Invalid values throw at render. */
  holdDuration?: number;
  /** Button label. Default: 'Hold to Delete' */
  label?: string;
  /** Label shown while holding. Default: 'Deleting...' */
  holdingLabel?: string;
  /** Icon element. Default: Trash2 */
  icon?: React.ReactNode;
  /** Additional class names */
  className?: string;
  /** Fill color class. Default: 'bg-destructive' */
  fillClass?: string;
  /** Text color before 40% fill. Default: 'text-destructive' */
  textClass?: string;
  /** Text color after 40% fill. Default: 'text-destructive-foreground' */
  textFilledClass?: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Confirms once after a sustained primary-pointer, Space or Enter hold. Release,
 * loss of focus/visibility, unmount or action replacement cancels pending work.
 * onConfirm owns the action; this component does not await its side effects.
 */
export function HoldButton({
  onConfirm,
  holdDuration = 1500,
  label = 'Hold to Delete',
  holdingLabel = 'Deleting...',
  icon = <Trash2 className="size-4" />,
  className,
  fillClass = 'bg-destructive',
  textClass = 'text-destructive',
  textFilledClass = 'text-destructive-foreground',
}: HoldButtonProps) {
  if (!Number.isFinite(holdDuration) || holdDuration <= 0) {
    throw new Error('HoldButton holdDuration must be a finite number greater than zero.');
  }
  const [progress, setProgress] = useState(0);
  const [holding, setHolding] = useState(false);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number>(0);
  const activeHoldRef = useRef(false);

  const reset = useCallback(() => {
    activeHoldRef.current = false;
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    setHolding(false);
    setProgress(0);
  }, []);

  const handleComplete = useCallback(() => {
    reset();
    onConfirm();
  }, [reset, onConfirm]);

  const tick = useCallback(() => {
    if (!activeHoldRef.current) return;
    // Confirmation duration is elapsed time, not a system-clock deadline.
    const elapsed = performance.now() - startRef.current;
    const pct = Math.min(elapsed / holdDuration, 1);
    setProgress(pct);

    if (pct >= 1) {
      handleComplete();
      return;
    }

    rafRef.current = requestAnimationFrame(tick);
  }, [holdDuration, handleComplete]);

  const startHold = useCallback(() => {
    if (activeHoldRef.current) return;
    activeHoldRef.current = true;
    startRef.current = performance.now();
    setHolding(true);
    rafRef.current = requestAnimationFrame(tick);
  }, [tick]);

  const endHold = reset;

  useEffect(() => {
    // A changed action/duration invalidates the in-progress confirmation too.
    reset();
    const cancelWhenHidden = () => {
      if (document.visibilityState === 'hidden') reset();
    };
    // Pointer/key release is not guaranteed to reach this button after switching
    // windows or tabs. Hidden-page frame throttling must not complete a hold.
    window.addEventListener('blur', reset);
    document.addEventListener('visibilitychange', cancelWhenHidden);
    return () => {
      window.removeEventListener('blur', reset);
      document.removeEventListener('visibilitychange', cancelWhenHidden);
      activeHoldRef.current = false;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [reset, holdDuration, onConfirm]);

  return (
    <button
      type="button"
      aria-label={label}
      onPointerDown={(event) => {
        if (event.button === 0 && event.isPrimary) startHold();
      }}
      onPointerUp={endHold}
      onPointerLeave={endHold}
      onPointerCancel={endHold}
      onBlur={endHold}
      onKeyDown={(event) => {
        if (event.key !== ' ' && event.key !== 'Enter') return;
        event.preventDefault();
        if (!event.repeat) startHold();
      }}
      onKeyUp={(event) => {
        if (event.key !== ' ' && event.key !== 'Enter') return;
        event.preventDefault();
        endHold();
      }}
      onContextMenu={(e) => e.preventDefault()}
      className={cn(
        'relative h-11 w-full cursor-pointer select-none touch-none overflow-hidden rounded-md border border-destructive text-sm font-medium transition-colors',
        className,
      )}
    >
      <div
        className={cn('absolute inset-0', fillClass)}
        style={{
          transform: `scaleX(${progress})`,
          transformOrigin: 'left',
          transition: holding ? 'none' : 'transform 0.3s ease-out',
        }}
      />
      <span
        className={cn(
          'relative z-10 flex items-center justify-center gap-2 transition-colors duration-150',
          progress > 0.4 ? textFilledClass : textClass,
        )}
      >
        {icon}
        {holding
          ? `${holdingLabel} ${Math.round(progress * 100)}%`
          : label}
      </span>
    </button>
  );
}
