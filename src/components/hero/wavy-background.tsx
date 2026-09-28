'use client';

/**
 * wavy-background.tsx
 *
 * Renders a canvas-driven public Hero wave background. This file owns the
 * animation loop and canvas drawing only; Hero owns content layout and callers
 * own copy, navigation, and section structure.
 */

import * as React from 'react';

import { cn } from '#zero/lib/utils';

const DEFAULT_WAVE_COLORS = [
  '#38bdf8',
  '#818cf8',
  '#c084fc',
  '#e879f9',
  '#22d3ee',
] as const;

const SPEED_FACTORS = {
  slow: 0.45,
  default: 0.75,
  fast: 1.15,
} as const;

export interface WavyBackgroundProps extends React.ComponentProps<'div'> {
  colors?: readonly string[];
  waveWidth?: number;
  backgroundFill?: string;
  blur?: number;
  speed?: keyof typeof SPEED_FACTORS;
  waveOpacity?: number;
}

/** Render a reusable animated wave canvas for public Hero backgrounds. */
export function WavyBackground({
  colors = DEFAULT_WAVE_COLORS,
  waveWidth = 48,
  backgroundFill,
  blur = 8,
  speed = 'default',
  waveOpacity = 0.48,
  className,
  children,
  ...props
}: WavyBackgroundProps) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const frameRef = React.useRef<number | null>(null);
  const optionsRef = React.useRef({
    colors,
    waveWidth,
    backgroundFill,
    blur,
    speed,
    waveOpacity,
  });

  React.useEffect(() => {
    optionsRef.current = {
      colors,
      waveWidth,
      backgroundFill,
      blur,
      speed,
      waveOpacity,
    };
  }, [backgroundFill, blur, colors, speed, waveOpacity, waveWidth]);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;

    let width = 0;
    let height = 0;
    let time = 0;

    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const draw = () => {
      const options = optionsRef.current;
      time += SPEED_FACTORS[options.speed];

      context.clearRect(0, 0, width, height);
      if (options.backgroundFill) {
        context.fillStyle = options.backgroundFill;
        context.fillRect(0, 0, width, height);
      }

      context.save();
      context.globalAlpha = options.waveOpacity;
      context.lineWidth = options.waveWidth;
      context.filter = `blur(${options.blur}px)`;

      const waveCount = Math.max(1, options.colors.length);
      const baseY = height * 0.56;
      const amplitude = Math.max(42, height * 0.12);
      const frequency = 0.008;

      for (let index = 0; index < waveCount; index += 1) {
        context.beginPath();
        context.strokeStyle = options.colors[index] ?? DEFAULT_WAVE_COLORS[index % DEFAULT_WAVE_COLORS.length];

        const phase = time * (0.012 + index * 0.002) + index * 0.9;
        const offsetY = (index - waveCount / 2) * 24;

        for (let x = -options.waveWidth; x <= width + options.waveWidth; x += 8) {
          const y =
            baseY +
            offsetY +
            Math.sin(x * frequency + phase) * amplitude +
            Math.sin(x * frequency * 0.42 + phase * 1.8) * (amplitude * 0.38);

          if (x <= -options.waveWidth) context.moveTo(x, y);
          else context.lineTo(x, y);
        }

        context.stroke();
      }

      context.restore();
      frameRef.current = requestAnimationFrame(draw);
    };

    resize();
    window.addEventListener('resize', resize);
    frameRef.current = requestAnimationFrame(draw);

    return () => {
      window.removeEventListener('resize', resize);
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
    };
  }, []);

  return (
    <div
      data-slot="wavy-background"
      className={cn('relative size-full overflow-hidden bg-public-background', className)}
      {...props}
    >
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="absolute inset-0 size-full"
      />
      {children ? <div className="relative z-10">{children}</div> : null}
    </div>
  );
}
