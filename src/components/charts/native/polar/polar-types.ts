/** Native polar chart contracts. Stable IDs describe real measurements; no chart-library or transport types. */
import type { ReactNode, Ref } from 'react';

export interface PolarChartPresentation {
  readonly label: string;
  readonly title?: string;
  readonly subtitle?: string;
  readonly className?: string;
  readonly motion?: boolean;
  readonly width?: number;
  readonly height?: number;
  readonly ref?: Ref<HTMLElement>;
  readonly formatValue?: (value: number) => string;
}
export interface PolarChartSelection {
  readonly activeId?: string | null;
  readonly defaultActiveId?: string | null;
  readonly onActiveChange?: (id: string | null) => void;
}
export interface PolarChartVisibility {
  readonly hiddenIds?: readonly string[];
  readonly defaultHiddenIds?: readonly string[];
  readonly onHiddenIdsChange?: (ids: string[]) => void;
  readonly legend?: boolean;
}
export interface RadarAxis { readonly id: string; readonly label: string; readonly min?: number; readonly max: number }
export interface RadarValue { readonly id: string; readonly value: number }
export interface RadarProfile { readonly id: string; readonly label: string; readonly values: readonly RadarValue[]; readonly color?: string }
export interface RadarAxisModel { readonly id: string; readonly label: string; readonly min: number; readonly max: number }
export interface RadarMeasurement { readonly id: string; readonly value: number; readonly ratio: number; readonly clipped: boolean }
export interface RadarProfileModel { readonly id: string; readonly label: string; readonly values: readonly RadarMeasurement[]; readonly color?: string; readonly index: number }
export interface RadarModel { readonly axes: readonly RadarAxisModel[]; readonly profiles: readonly RadarProfileModel[]; readonly visibleProfiles: readonly RadarProfileModel[]; readonly hiddenIds: readonly string[] }
export interface RadarTooltipContext { readonly profile: RadarProfileModel; readonly axis: RadarAxisModel; readonly measurement: RadarMeasurement }
export interface RadarChartProps extends PolarChartPresentation, PolarChartSelection, PolarChartVisibility {
  readonly axes: readonly RadarAxis[];
  readonly profiles: readonly RadarProfile[];
  /** A profile is selected by stable ID; the inspector previews one exact axis measurement. */
  readonly renderTooltip?: (context: RadarTooltipContext) => ReactNode;
  readonly levels?: number;
}
export interface RadialBarDatum { readonly id: string; readonly label: string; readonly value: number; readonly min?: number; readonly max: number; readonly color?: string }
export interface RadialBarItem { readonly id: string; readonly label: string; readonly value: number; readonly min: number; readonly max: number; readonly ratio: number; readonly rawRatio: number; readonly clipped: boolean; readonly color?: string; readonly index: number }
export interface RadialBarModel { readonly data: readonly RadialBarItem[] }
export interface RadialBarChartProps extends PolarChartPresentation, PolarChartSelection {
  readonly data: readonly RadialBarDatum[];
  readonly startAngle?: number;
  readonly endAngle?: number;
  /** Radius as a fraction of the available outer radius, in [0, .8]. */
  readonly innerRadius?: number;
  readonly ringGap?: number;
  readonly legend?: boolean;
  readonly renderTooltip?: (context: RadialBarItem) => ReactNode;
}
export interface PieDatum { readonly id: string; readonly label: string; readonly value: number; readonly color?: string }
export interface PieSlice { readonly id: string; readonly label: string; readonly value: number; readonly color?: string; readonly index: number; readonly share: number; readonly hidden: boolean }
export interface PieModel { readonly data: readonly PieSlice[]; readonly slices: readonly PieSlice[]; readonly total: number; readonly fullTotal: number; readonly hiddenIds: readonly string[] }
export interface PieChartProps extends PolarChartPresentation, PolarChartSelection, PolarChartVisibility {
  readonly data: readonly PieDatum[];
  readonly startAngle?: number;
  readonly unit?: string;
  readonly renderTooltip?: (context: PieSlice & { readonly total: number; readonly fullTotal: number }) => ReactNode;
}
export interface SunburstNode { readonly id: string; readonly label: string; readonly value?: number; readonly color?: string; readonly children?: readonly SunburstNode[] }
export interface SunburstNodeModel { readonly id: string; readonly label: string; readonly value: number; readonly declaredValue: number | null; readonly color?: string; readonly parentId: string | null; readonly depth: number; readonly index: number; readonly children: readonly SunburstNodeModel[] }
export interface SunburstModel { readonly root: SunburstNodeModel; readonly nodes: readonly SunburstNodeModel[]; readonly total: number; readonly depth: number }
export interface SunburstSector { readonly id: string; readonly node: SunburstNodeModel; readonly start: number; readonly end: number; readonly inner: number; readonly outer: number; readonly share: number; readonly parentShare: number; readonly colorIndex: number; readonly color?: string }
export interface SunburstLayout { readonly sectors: readonly SunburstSector[]; readonly root: SunburstNodeModel; readonly ancestors: readonly SunburstNodeModel[]; readonly depth: number }
export interface SunburstTooltipContext { readonly node: SunburstNodeModel; readonly root: SunburstNodeModel; readonly share: number; readonly parentShare: number }
export interface SunburstChartProps extends PolarChartPresentation, PolarChartSelection {
  readonly data: SunburstNode;
  readonly rootId?: string | null;
  readonly defaultRootId?: string | null;
  readonly onRootChange?: (id: string | null) => void;
  readonly startAngle?: number;
  readonly renderTooltip?: (context: SunburstTooltipContext) => ReactNode;
}
export interface PolarPoint { readonly x: number; readonly y: number }
export interface RadarProfileLayout { readonly id: string; readonly path: string; readonly points: readonly (PolarPoint & {readonly axisId: string})[] }
export interface RadarLayout { readonly width: number; readonly height: number; readonly cx: number; readonly cy: number; readonly radius: number; readonly levels: readonly string[]; readonly axes: readonly (PolarPoint & {readonly id: string;readonly end: PolarPoint})[]; readonly profiles: readonly RadarProfileLayout[] }
export interface PolarSector { readonly id: string; readonly start: number; readonly end: number; readonly inner: number; readonly outer: number }
export interface RadialBarLayout { readonly width: number; readonly height: number; readonly cx: number; readonly cy: number; readonly sectors: readonly (PolarSector & {readonly item: RadialBarItem;readonly trackEnd: number})[] }
export interface PieLayout { readonly width: number; readonly height: number; readonly cx: number; readonly cy: number; readonly sectors: readonly (PolarSector & {readonly slice: PieSlice})[] }
