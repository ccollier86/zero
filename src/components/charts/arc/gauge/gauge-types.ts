/** Typed inputs for the Zero Arc-derived Gauge; thresholds name states rather than relying on color alone. */
export type GaugeTone = "accent" | "success" | "warning" | "danger";
export interface GaugeThreshold { readonly from: number; readonly tone: GaugeTone; readonly label: string }
export interface GaugeProps { value: number; min?: number; max?: number; label: string; detail?: string; tone?: GaugeTone; thresholds?: readonly GaugeThreshold[]; className?: string; motion?: boolean }
export interface GaugeModel { readonly value: number; readonly min: number; readonly max: number; readonly percentage: number; readonly displayValue: number; readonly thresholds: readonly GaugeThreshold[]; readonly band: GaugeThreshold | undefined }
