/** Pure geometry for decorating an existing scroll viewport; it does not scroll, render or create another viewport. */
export type ScrollViewportOrientation = 'vertical' | 'horizontal' | 'both';

export interface ScrollViewportDimensions {
  readonly width: number;
  readonly height: number;
  readonly contentWidth: number;
  readonly contentHeight: number;
  readonly left: number;
  readonly top: number;
  readonly rtl?: boolean;
}
export interface ScrollViewportAxis {
  readonly overflow: boolean;
  readonly maximum: number;
  readonly offset: number;
  readonly track: number;
  readonly thumb: number;
  readonly position: number;
}
export interface ScrollViewportMetrics {
  readonly x: ScrollViewportAxis;
  readonly y: ScrollViewportAxis;
  readonly edges: { readonly top: number; readonly bottom: number; readonly left: number; readonly right: number };
}

const positive = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0;
const clamp = (value: number, max: number) => Math.max(0, Math.min(max, Number.isFinite(value) ? value : 0));

/** Uses physical left-to-right offsets, including the native negative RTL scrollLeft convention. */
export function measureScrollViewport(dimensions: ScrollViewportDimensions, orientation: ScrollViewportOrientation = 'vertical',
  threshold = .5, minimumThumb = 28): ScrollViewportMetrics {
  const width = positive(dimensions.width), height = positive(dimensions.height);
  const maxX = positive(dimensions.contentWidth - width), maxY = positive(dimensions.contentHeight - height);
  const x = orientation !== 'vertical' && maxX > positive(threshold);
  const y = orientation !== 'horizontal' && maxY > positive(threshold);
  function axis(size: number, content: number, maximum: number, rawOffset: number, overflow: boolean, corner: boolean): ScrollViewportAxis {
    const offset = clamp(rawOffset, maximum), track = positive(size - 6 - (corner ? 10 : 0));
    const thumb = Math.min(track, Math.max(positive(minimumThumb), content > 0 ? track * size / content : track));
    return { overflow, maximum, offset, track, thumb, position: maximum > 0 ? offset / maximum * positive(track - thumb) : 0 };
  }
  const horizontal = axis(width, positive(dimensions.contentWidth), maxX, dimensions.rtl ? maxX + dimensions.left : dimensions.left, x, x && y);
  const vertical = axis(height, positive(dimensions.contentHeight), maxY, dimensions.top, y, x && y);
  return { x: horizontal, y: vertical, edges: {
    top: y ? vertical.offset : 0, bottom: y ? maxY - vertical.offset : 0,
    left: x ? horizontal.offset : 0, right: x ? maxX - horizontal.offset : 0,
  } };
}
