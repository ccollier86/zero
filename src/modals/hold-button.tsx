'use client';

import { useState, useRef, useCallback } from 'react';
import { Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface HoldButtonProps {
  /** Callback when hold completes */
  onConfirm: () => void;
  /** Hold duration in ms. Default: 1500 */
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
  const [progress, setProgress] = useState(0);
  const [holding, setHolding] = useState(false);
  const rafRef = useRef<number>(0);
  const startRef = useRef<number>(0);

  const reset = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    setHolding(false);
    setProgress(0);
  }, []);

  const handleComplete = useCallback(() => {
    reset();
    onConfirm();
  }, [reset, onConfirm]);

  const tick = useCallback(() => {
    const elapsed = Date.now() - startRef.current;
    const pct = Math.min(elapsed / holdDuration, 1);
    setProgress(pct);

    if (pct >= 1) {
      handleComplete();
      return;
    }

    rafRef.current = requestAnimationFrame(tick);
  }, [holdDuration, handleComplete]);

  const startHold = useCallback(() => {
    startRef.current = Date.now();
    setHolding(true);
    rafRef.current = requestAnimationFrame(tick);
  }, [tick]);

  const endHold = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    setHolding(false);
    setProgress(0);
  }, []);

  return (
    <button
      type="button"
      onPointerDown={startHold}
      onPointerUp={endHold}
      onPointerLeave={endHold}
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
