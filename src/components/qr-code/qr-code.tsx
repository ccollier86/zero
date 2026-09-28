'use client';

/**
 * qr-code.tsx
 *
 * Renders a token-aware QR code primitive for setup flows. This file owns QR
 * matrix rendering only; callers own token generation and verification.
 */

import * as React from 'react';
import { create } from 'qrcode';
import type { QRCodeErrorCorrectionLevel } from 'qrcode';

import { cn } from '#zero/lib/utils';

export interface QRCodeProps {
  value: string;
  size?: number;
  margin?: number;
  robustness?: QRCodeErrorCorrectionLevel;
  title?: string;
  className?: string;
  moduleClassName?: string;
}
/** Render a CSS-token-colored QR code from a string value. */
export function QRCode({
  value,
  size = 192,
  margin = 4,
  robustness = 'M',
  title = 'QR code',
  className,
  moduleClassName,
}: QRCodeProps) {
  const matrix = React.useMemo(() => {
    if (!value.trim()) return null;
    return create(value, { errorCorrectionLevel: robustness }).modules;
  }, [value, robustness]);

  if (!matrix) {
    return (
      <div
        className={cn(
          'flex items-center justify-center rounded-lg border border-border/80 bg-card text-xs text-muted-foreground',
          className,
        )}
        style={{ width: size, height: size }}
        role="img"
        aria-label={`${title} unavailable`}
      >
        No QR data
      </div>
    );
  }

  const moduleCount = matrix.size + margin * 2;
  const cells = [];

  for (let row = 0; row < moduleCount; row += 1) {
    for (let col = 0; col < moduleCount; col += 1) {
      const matrixRow = row - margin;
      const matrixCol = col - margin;
      const filled =
        matrixRow >= 0 &&
        matrixCol >= 0 &&
        matrixRow < matrix.size &&
        matrixCol < matrix.size &&
        matrix.get(matrixRow, matrixCol) === 1;

      cells.push(
        <span
          key={`${row}-${col}`}
          aria-hidden="true"
          className={cn(filled ? 'bg-current' : 'bg-transparent', moduleClassName)}
        />,
      );
    }
  }

  return (
    <div
      className={cn(
        'inline-grid overflow-hidden rounded-lg border border-border/80 bg-card p-3 text-foreground shadow-xs',
        className,
      )}
      style={{
        width: size,
        height: size,
        gridTemplateColumns: `repeat(${moduleCount}, minmax(0, 1fr))`,
      }}
      role="img"
      aria-label={title}
    >
      {cells}
    </div>
  );
}
