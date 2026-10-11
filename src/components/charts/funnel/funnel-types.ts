/**
 * Renderer-independent Funnel aggregate, inspection and geometry contracts.
 * Inputs describe ordered cohort counts, never individual observed events or
 * transport/query definitions. These types have no React or browser dependency.
 */

/** One declared cohort; colors cycle through the shared categorical palette. */
export interface FunnelSegmentInput {
  readonly id: string;
  readonly label?: string;
}

/** A conversion stage. Missing own counts mean zero; supplied counts are not coerced. */
export interface FunnelStageInput {
  readonly id: string;
  readonly label?: string;
  /** For unsegmented data only; use values when segments are declared. */
  readonly value?: number;
  readonly values?: Readonly<Record<string, number>>;
}

/** Ordered, already authorized aggregate counts from one consistent cohort. */
export interface FunnelData {
  readonly segments?: readonly FunnelSegmentInput[];
  readonly stages: readonly FunnelStageInput[];
}

/** Tagged choices keep segment IDs such as "total" and "split" unambiguous. */
export type FunnelView = { readonly kind: 'total' } | { readonly kind: 'split' }
  | { readonly kind: 'segment'; readonly id: string };

/** Owned identity with a zero-based dense-vector index and one-based series. */
export interface FunnelModelSegment {
  readonly id: string;
  readonly label: string;
  readonly index: number;
  readonly series: number;
}

/** Owned stage counts in segment declaration order; unsegmented data has one value. */
export interface FunnelModelStage {
  readonly id: string;
  readonly label: string;
  readonly index: number;
  readonly values: readonly number[];
  readonly total: number;
}

/** Validated immutable arrays and stable ID lookups; no caller records are retained. */
export interface FunnelModel {
  readonly segments: readonly FunnelModelSegment[];
  readonly stages: readonly FunnelModelStage[];
  readonly segmentById: ReadonlyMap<string, FunnelModelSegment>;
  readonly stageById: ReadonlyMap<string, FunnelModelStage>;
  readonly stageCount: number;
  readonly segmentCount: number;
}

/** Exact aggregate metadata. A zero denominator has unknown rate, represented by null. */
export interface FunnelStageSnapshot {
  readonly stage: FunnelModelStage;
  readonly value: number;
  readonly fromStart: number | null;
  readonly keptFromPrevious: number | null;
  readonly dropOff: number | null;
}

/** Exact totals for one view, independent of any animated number or geometry. */
export interface FunnelSnapshot {
  readonly view: FunnelView;
  readonly baseline: number;
  readonly values: readonly FunnelStageSnapshot[];
  readonly conversionRate: number | null;
}

/** One inspector count row; null segment means the aggregate total. */
export interface FunnelInspectionRow {
  readonly segment: FunnelModelSegment | null;
  readonly value: number;
  readonly fromStart: number | null;
  readonly keptFromPrevious: number | null;
}

/** Inspector values always describe observed aggregate inputs, not animated estimates. */
export interface FunnelInspection extends FunnelStageSnapshot {
  readonly view: FunnelView;
  readonly total: number;
  readonly previousStage: FunnelModelStage | null;
  readonly rows: readonly FunnelInspectionRow[];
  readonly conversionRate: number | null;
}

/** Automatic orientation turns vertical below the reference's 420px breakpoint. */
export type FunnelOrientation = 'auto' | 'horizontal' | 'vertical';

/** Actual container width, not a prototype's minimum demo width. */
export interface FunnelLayoutOptions {
  readonly width: number;
  readonly height?: number;
  readonly orientation?: FunnelOrientation;
}

/** Abstract along/cross geometry, with a browser-independent SVG mapping. */
export interface FunnelLayout {
  readonly vertical: boolean;
  readonly width: number;
  readonly height: number;
  readonly stepSize: number;
  readonly along: number;
  readonly cross: number;
  readonly headerHeight: number;
  readonly transitionZone: number;
  readonly labelWidth: number;
  readonly labelGap: number;
  readonly mapPoint: (along: number, cross: number) => readonly [number, number];
}

/** Upper and lower smooth boundaries for one displayed segment. */
export interface FunnelBandEdges {
  readonly top: readonly number[];
  readonly bottom: readonly number[];
}

/** Aggregate-derived departure distribution, not an individual event trace. */
export interface FunnelParticleDistribution {
  readonly segmentIndex: number;
  readonly segmentId: string | null;
  readonly weight: number;
  /** Entry share at each departure stage; index stageCount is the surviving share. */
  readonly departures: readonly number[];
}

/** An illustrative dot's segment and preselected terminal stage. */
export interface FunnelParticleSample {
  readonly segmentIndex: number;
  readonly segmentId: string | null;
  /** The stage it leaves after; stageCount means it survives every stage. */
  readonly leaveStage: number;
  readonly lane: number;
  readonly speed: number;
}

/** Mutable presentation coordinates owned by a renderer, not aggregate data. */
export interface FunnelSpringState {
  x: number;
  v: number;
}

/** Reference geometry settles absolutely; large aggregate readouts may settle relatively. */
export interface FunnelSpringOptions {
  readonly tolerance?: number;
  readonly relative?: boolean;
}
