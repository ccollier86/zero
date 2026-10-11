/** Typed Zero-facing waffle-chart inputs and presentation configuration; renderer consumes validated models only. */
import type { Ref, ReactNode } from "react";
/** Exact raw aggregate and allocated-cell reading exposed to custom noninteractive inspectors. */
export interface WaffleTooltipContext { category: WaffleCategory; value: number; share: number; cells: number; slot: number; total: number }

export interface WaffleCategory {
  /** Stable identity. Cells keep following their category when the data changes, so a new dataset flows instead of repainting. */
  id: string;
  /** Name in the legend, the tooltip, and the data table. */
  label: string;
  /** Finite nonnegative raw amount. Invalid counts reject rather than silently changing the supplied data. */
  value: number;
  /** Any CSS color. Defaults to the first series for accentId, the supporting series for the next three, then neutral steps. */
  color?: string;
}

/** A unit chart: every cell is one share of the whole, so parts of a total read as countable squares. */
export interface WaffleChartProps {
  /** Disable all decorative motion; exact data and interaction remain available. */
  motion?: boolean;
  /** undefined uses the built-in inspector; null hides it without suppressing category highlighting. */
  renderCategoryTooltip?: (context: WaffleTooltipContext) => ReactNode;
  /** Categories in fill order. The first fills from the bottom-left corner, column by column. */
  data: readonly WaffleCategory[];
  /** What the whole is, such as "Electricity generation, 2023". Names the chart for assistive technology. */
  label: string;
  /** Unit after each raw value in the tooltip and table, such as "TWh". */
  unit?: string;
  formatValue?: (value: number, category: WaffleCategory) => string;
  /** Grid rows. rows × columns cells make the whole; 10 × 10 means one cell per percent. */
  rows?: number;
  columns?: number;
  /** The category painted in the accent. Pass null to keep every category neutral. Defaults to the first category. */
  accentId?: string | null;
  /** Controlled focused category. Others dim while one is focused. */
  activeId?: string | null;
  defaultActiveId?: string | null;
  onActiveChange?: (id: string | null) => void;
  /** Category list with shares that roll to their new value. */
  legend?: boolean;
  /** Decimal places for shares. */
  decimals?: number;
  emptyLabel?: string;
  ref?: Ref<HTMLElement>;
  className?: string;
}
