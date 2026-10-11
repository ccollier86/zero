/**
 * Pure Race Bar input, validation, snapshot and motion contracts. They are
 * renderer-independent and do not import React, browser APIs or data transport.
 */

/** A legend group. Series colors cycle through the four reference tokens. */
export interface RaceBarGroupInput {
  readonly id: string;
  readonly label?: string;
}

/** One ranked item; equal values retain this declaration order. */
export interface RaceBarItemInput {
  readonly id: string;
  readonly label?: string;
  readonly group?: string;
}

/** An aggregate period. Missing own item keys explicitly mean zero. */
export interface RaceBarFrameInput {
  /** Stable identity across reactive insertion/replacement; otherwise period is the identity. */
  readonly id?: string;
  readonly period: string;
  readonly values: Readonly<Record<string, number>>;
}

/** Already authorized, bounded aggregate history, not a browser query definition. */
export interface RaceBarData {
  readonly groups?: readonly RaceBarGroupInput[];
  readonly items: readonly RaceBarItemInput[];
  readonly frames: readonly RaceBarFrameInput[];
}

/** Owned group data and a one-based reference series index. */
export interface RaceBarModelGroup {
  readonly id: string;
  readonly label: string;
  readonly order: number;
  readonly series: number;
}

/** Validated item identity; index addresses each model frame's value vector. */
export interface RaceBarModelItem {
  readonly id: string;
  readonly label: string;
  readonly group: string | null;
  readonly order: number;
  readonly index: number;
  readonly series: number;
}

/** Validated period values, in item declaration order, with a finite honest total. */
export interface RaceBarModelFrame {
  readonly id: string;
  readonly period: string;
  readonly index: number;
  readonly values: Float64Array;
  readonly total: number;
}

/** Copied model: later mutations to caller arrays/value records cannot alter it. */
export interface RaceBarModel {
  readonly groups: readonly RaceBarModelGroup[];
  readonly items: readonly RaceBarModelItem[];
  readonly frames: readonly RaceBarModelFrame[];
  readonly byId: ReadonlyMap<string, RaceBarModelItem>;
  readonly groupById: ReadonlyMap<string, RaceBarModelGroup>;
  readonly frameById: ReadonlyMap<string, RaceBarModelFrame>;
}

/** A displayed, potentially interpolated value and zero-based current rank. */
export interface RaceBarRankedItem {
  readonly item: RaceBarModelItem;
  readonly value: number;
  readonly rank: number;
}

/** One presentation instant. Total includes every item, not just visible bars. */
export interface RaceBarSnapshot {
  readonly position: number;
  readonly lowerFrameIndex: number;
  readonly upperFrameIndex: number;
  /** Raw temporal fraction. The value blend applies the reference easing separately. */
  readonly fraction: number;
  /** Rounded period index used by the rolling label and frame callback. */
  readonly frameIndex: number;
  readonly interpolated: boolean;
  readonly rows: readonly RaceBarRankedItem[];
  readonly total: number;
}

/** Tooltip inspection keeps displayed interpolation separate from exact-period comparisons. */
export interface RaceBarInspection {
  readonly item: RaceBarModelItem;
  readonly value: number;
  readonly rank: number;
  readonly itemCount: number;
  readonly share: number;
  readonly total: number;
  readonly position: number;
  readonly interpolated: boolean;
  readonly fraction: number;
  readonly frameIndex: number;
  readonly frame: RaceBarModelFrame | null;
  readonly lowerFrame: RaceBarModelFrame | null;
  readonly upperFrame: RaceBarModelFrame | null;
  readonly previousFrame: RaceBarModelFrame | null;
  readonly frameValue: number;
  readonly previousValue: number | null;
  /** Exact rounded-period difference; never presented as the displayed interpolated difference. */
  readonly change: number | null;
  /** Null when no previous period exists or its value is zero. */
  readonly changeRatio: number | null;
}

/** Mutable position and velocity carried through target changes. */
export interface RaceBarSpringState {
  x: number;
  v: number;
}

/** Optional geometry measurement stays dependency-injected and SSR-safe. */
export interface RaceBarLayoutOptions {
  readonly width: number;
  readonly bars?: number;
  readonly formatValue?: (value: number) => string;
  readonly measureText?: (text: string, kind: 'label' | 'value') => number;
}

/** Reference row geometry clipped to the actual container rather than a demo minimum width. */
export interface RaceBarLayout {
  readonly W: number;
  readonly H: number;
  readonly inside: boolean;
  readonly rowH: number;
  readonly barH: number;
  readonly axisH: number;
  readonly labelW: number;
  readonly valW: number;
  readonly x0: number;
  readonly area: number;
  readonly n: number;
  readonly itemNameWidths: ReadonlyMap<string, number>;
}

/** Reference timing constants in milliseconds and spring frequencies per second. */
export interface RaceBarMotionSettings {
  readonly clock: number;
  readonly scrub: number;
  readonly row: number;
  readonly opacity: number;
  readonly tick: number;
  readonly periodEnterMs: number;
  readonly periodExitMs: number;
}
