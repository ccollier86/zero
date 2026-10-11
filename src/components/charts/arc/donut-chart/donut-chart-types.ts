/** Typed Zero-facing donut-chart inputs and presentation configuration; renderer consumes validated models only. */
import type { Ref } from "react";

export interface DonutChartDatum {
  /** Stable identity. A segment whose key survives a data change keeps its place and color, so switching datasets morphs the arcs. */
  id: string;
  label: string;
  value: number;
  /** Any CSS color. Segments default to the shared --series-* palette in data order, then neutral steps. */
  color?: string;
}

/** Use a donut chart for a few parts of one whole, when the share of each part matters more than precise comparison. */
export interface DonutChartProps {
  /** Disable all decorative motion; exact data and interaction remain available. */
  motion?: boolean;
  data: readonly DonutChartDatum[];
  /** What the whole is, such as "Visits by source". Names the chart for assistive technology. */
  label: string;
  /** Unit after values, such as "visits". */
  unit?: string;
  formatValue?: (value: number) => string;
  /** Center label at rest, above the total. */
  totalLabel?: string;
  /** Diameter in pixels. The chart scales down to fit narrower containers. */
  size?: number;
  /** Ring thickness in pixels. */
  thickness?: number;
  /** Segments below this share of the total join "Other". */
  groupBelow?: number;
  /** The most segments drawn, counting "Other". The smallest parts beyond it are grouped. */
  maxSegments?: number;
  otherLabel?: string;
  /** Controlled selected segment key. Hover and focus preview other segments without changing it. */
  activeId?: string | null;
  defaultActiveId?: string | null;
  onActiveChange?: (id: string | null) => void;
  /** Controlled hidden segment keys. A hidden segment closes and the rest of the ring redistributes. */
  hiddenIds?: readonly string[];
  defaultHiddenIds?: readonly string[];
  onHiddenIdsChange?: (keys: string[]) => void;
  /** What clicking a legend row does: show or hide its segment, or pin it as the selected segment. */
  legendAction?: "toggle" | "select";
  /** The synced legend beside or below the ring. */
  legend?: boolean;
  emptyLabel?: string;
  ref?: Ref<HTMLElement>;
  className?: string;
}
