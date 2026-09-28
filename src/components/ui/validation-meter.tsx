'use client';

import * as React from 'react';
import { motion } from 'motion/react';

import { cn } from '#zero/lib/utils';
import { Fade } from '#zero/components/animate-ui/primitives/effects/fade';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ValidationMeterProps {
  /** Score from 0 to segments count. */
  score: number;
  /** Number of segments. Default: 4 */
  segments?: number;
  /** Labels for each score level. */
  labels?: string[];
  /** Colors per segment (left to right). */
  colors?: string[];
  /** Show label text. Default: true */
  showLabel?: boolean;
  className?: string;
}

// ─── Default colors ──────────────────────────────────────────────────────────

const defaultColors = [
  'rgb(239, 68, 68)',   // red-500 / destructive
  'rgb(249, 115, 22)',  // orange-500
  'rgb(234, 179, 8)',   // yellow-500
  'rgb(34, 197, 94)',   // green-500
];

// ─── ValidationMeter ─────────────────────────────────────────────────────────

function ValidationMeter({
  score,
  segments = 4,
  labels,
  colors = defaultColors,
  showLabel = true,
  className,
}: ValidationMeterProps) {
  const activeColor = score > 0 ? colors[Math.min(score, colors.length) - 1] : undefined;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex gap-1">
        {Array.from({ length: segments }, (_, i) => {
          const filled = i < score;
          const segmentColor = filled ? colors[Math.min(score, colors.length) - 1] : undefined;

          return (
            <div key={i} className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
              <motion.div
                className="h-full rounded-full origin-left"
                initial={{ scaleX: 0 }}
                animate={{
                  scaleX: filled ? 1 : 0,
                  backgroundColor: segmentColor ?? 'transparent',
                }}
                transition={{
                  scaleX: { type: 'spring', stiffness: 300, damping: 25 },
                  backgroundColor: { type: 'spring', stiffness: 200, damping: 20 },
                }}
                style={{ backgroundColor: segmentColor }}
              />
            </div>
          );
        })}
      </div>

      {showLabel && labels && score > 0 && labels[score] && (
        <Fade delay={100}>
          <span
            className="text-xs font-medium"
            style={{ color: activeColor }}
          >
            {labels[score]}
          </span>
        </Fade>
      )}
    </div>
  );
}

export { ValidationMeter, type ValidationMeterProps };
