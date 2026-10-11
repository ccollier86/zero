/**
 * Pure public Sankey data, model, trace and geometry contracts. These types do
 * not depend on React, browser globals, query transport or persistence.
 */

/** One declared stage node. Column pins must leave every edge moving forward. */
export interface SankeyNodeInput {
  readonly id: string;
  readonly label?: string;
  readonly column?: number;
}

/** A nonnegative aggregate flow; anonymous parallel endpoint pairs are summed. */
export interface SankeyLinkInput {
  readonly id?: string;
  readonly source: string;
  readonly target: string;
  readonly value: number;
}

/** Immutable aggregate inputs; this is not a claim of individual journey paths. */
export interface SankeyData {
  readonly nodes: readonly SankeyNodeInput[];
  readonly links: readonly SankeyLinkInput[];
}

/** Bounded model node; compositions contain amounts for each model origin. */
export interface SankeyModelNode {
  id: string;
  label: string;
  given: number | null;
  order: number;
  in: number;
  out: number;
  value: number;
  c: number;
  inL: SankeyModelLink[];
  outL: SankeyModelLink[];
  origin?: number;
  /** Sources use series 1–6; neutral and midstream-contributor nodes use 0. */
  hue: number;
  comp: Float64Array;
}

/** Stable link identity with endpoint references owned by the same model. */
export interface SankeyModelLink {
  id: string;
  key: string;
  s: SankeyModelNode;
  t: SankeyModelNode;
  value: number;
  comp: Float64Array;
}

/** Validated acyclic aggregate model. Zero-value nodes stay in all, not nodes. */
export interface SankeyModel {
  nodes: SankeyModelNode[];
  all: SankeyModelNode[];
  byId: Map<string, SankeyModelNode>;
  links: SankeyModelLink[];
  linkBy: Map<string, SankeyModelLink>;
  cols: SankeyModelNode[][];
  ncol: number;
  origins: SankeyModelNode[];
  O: number;
  total: number;
}

/** Discriminated identities avoid ambiguity when node and link IDs coincide. */
export interface SankeyTraceTarget {
  readonly kind: 'node' | 'link';
  readonly id: string;
}

/** Amount and distance used to animate a proportional trace through a node. */
export interface SankeyNodeTrace {
  amt: number;
  comp: Float64Array;
  d: number;
  self?: boolean;
}

/** A link trace pours along its leading edge, upstream, downstream or centrally. */
export interface SankeyLinkTrace extends SankeyNodeTrace {
  dir: 'up' | 'down' | 'self';
}

/** Proportional mixing result, not exact attribution of individual records. */
export interface SankeyTrace {
  target: SankeyTraceTarget;
  kind: 'node' | 'link';
  id: string;
  value: number;
  share: number;
  hue: number;
  nodes: Map<string, SankeyNodeTrace>;
  links: Map<string, SankeyLinkTrace>;
  cv: Float64Array;
}

/** Abstract geometry: a is along the flow and c is across the flow. */
export interface SankeyNodeGeometry {
  a0: number;
  a1: number;
  c0: number;
  c1: number;
  la: number;
  lc: number;
  lw?: number;
  two: boolean;
}

/** Source and target along coordinates, transverse offsets and ribbon width. */
export interface SankeyLinkGeometry {
  as: number;
  at: number;
  s0: number;
  t0: number;
  w: number;
}

/** Stage heading coordinates already use the actual SVG coordinate system. */
export interface SankeyColumnHeading {
  text: string;
  i: number;
  x: number;
  y: number;
  w: number;
}

/** Responsive layout inputs; optional text measurement keeps the math SSR-safe. */
export interface SankeyLayoutOptions {
  readonly width: number;
  readonly height?: number;
  readonly columns?: readonly string[];
  readonly orientation?: 'auto' | 'horizontal' | 'vertical';
  readonly formatValue?: (value: number) => string;
  readonly measureText?: (text: string, font: 'label' | 'value' | 'column') => number;
}

/** Completed geometry with one common scale for truthful column comparisons. */
export interface SankeyLayout {
  upright: boolean;
  W: number;
  H: number;
  nodes: Map<string, SankeyNodeGeometry>;
  links: Map<string, SankeyLinkGeometry>;
  heads: SankeyColumnHeading[];
  P: (along: number, across: number) => [number, number];
  nodeW: number;
  k: number;
}
