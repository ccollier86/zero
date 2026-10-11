/** Typed Zero-facing activity-heatmap inputs and presentation configuration; renderer consumes validated models only. */
import type { ReactNode } from "react";
/** Exact UTC day reading exposed to a custom noninteractive inspector. */
export interface ActivityDayTooltipContext { date: string; count: number; level: number }

export interface ActivityDay {
  /** Calendar day as YYYY-MM-DD. */
  date: string;
  count: number;
}

/**
 * A contribution style calendar: one square per day, weeks as columns, with four accent tints for how busy a day was.
 * Use it when rhythm, streaks, and quiet weeks matter more than exact comparisons; use a bar chart when the exact
 * comparison is the point. Cells wave in once on view, a tooltip glides between cells on hover or keyboard focus, and a
 * new range recolors the grid in a sweep instead of redrawing it. Arrow keys move by day and week, Enter selects.
 */
export interface ActivityHeatmapProps {
  /** Disable all decorative motion; exact data and interaction remain available. */
  motion?: boolean;
  /** undefined uses the built-in inspector; null hides it without removing the day from the grid. */
  renderDayTooltip?: (context: ActivityDayTooltipContext) => ReactNode;
  /** One entry per day, oldest first. Days missing inside the range count as zero. */
  days: readonly ActivityDay[];
  /** Accessible name for the grid, such as "Contributions in 2025". */
  label: string;
  /** Finishes the summary line: "1,284 contributions in {period}". */
  period: string;
  /** Nouns for the count. */
  unit?: { one: string; other: string };
  /** Upper bounds for levels one to three; anything above the last is level four. Defaults to quarters of the busiest day. */
  thresholds?: [number, number, number];
  weekStartsOn?: 0 | 1;
  selectedDate?: string | null;
  onSelectDate?: (date: string) => void;
  /** Controls beside the summary, such as a range switch. */
  actions?: ReactNode;
  /** Formatting locale. Fixed by default so server and client render the same labels. */
  locale?: string;
  className?: string;
}
