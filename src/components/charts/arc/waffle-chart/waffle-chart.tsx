/** Arc UI Free derivation. Copyright (c) 2026 Elia Kuratli, MIT. Owns cell/legend rendering and interaction; no data transport. */
"use client";

import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { animate, motion, useMotionValue, useSpring, useTransform } from "motion/react";
import { useArcChartEnvironment } from "../shared/use-arc-chart-environment";
import { motionTokens } from "../shared/motion-tokens";
import { styles } from "./waffle-chart-classes";
import type { WaffleCategory, WaffleChartProps } from "./waffle-chart-types";
import { buildWaffleModel, reassignWaffleCells as reassign } from "./waffle-chart-model";
import { Tooltip, TooltipTrigger, TooltipContent } from "../../../tooltip";
export type { WaffleCategory, WaffleChartProps, WaffleTooltipContext } from "./waffle-chart-types";

type Pointer = { categoryId: string; slot: number } | null;

const { spring } = motionTokens;
const GAP = 3;
/** accentId takes the first series and the next three categories the supporting series. Anything past that falls back to neutral steps that alternate in lightness. */
const SHADES = [40, 20, 30, 14];
/** A second, colour-free channel: neutral categories cycle through square, round, and framed cells, so neighbours differ in shape as well as lightness. */
const SHAPES = ["square", "round", "framed"] as const;
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const grouped = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });



/** A share that rolls to its new value on a spring and holds its width with tabular figures. */
function Rolling({ value, decimals, reduced }: { value: number; decimals: number; reduced: boolean }) {
  const shown = useMotionValue(value);
  const text = useTransform(shown, current => `${current.toFixed(decimals)}%`);
  useEffect(() => {
    if (reduced) { shown.jump(value); return; }
    const controls = animate(shown, value, spring.smooth);
    return () => controls.stop();
  }, [reduced, shown, value]);
  return <motion.span>{text}</motion.span>;
}

/** Arc-derived persistent cell chart; exact allocation, stable physical cells and controlled category identities. */
export function WaffleChart({ data: input, label, unit = "", formatValue, rows = 10, columns = 10, accentId, activeId, defaultActiveId = null, onActiveChange, legend = true, decimals = 0, emptyLabel = "No data", ref, className, motion: motionEnabled = true, renderCategoryTooltip }: WaffleChartProps) {
  const model = buildWaffleModel(input, rows, columns, decimals);
  if(typeof label !== "string" || (!label.trim() || label.length > 4096)) throw new TypeError("Waffle: label required");
  const data = model.data;
  const figure = useRef<HTMLElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => figure.current as HTMLElement);
  const environment = useArcChartEnvironment(figure, { motion: motionEnabled });
  const inView = environment.inView, reduced = environment.reduced;
  const count = model.cellCount;
  const total = model.total;
  const empty = !data.length || total <= 0;
  const accent = accentId === undefined ? data[0]?.id ?? null : accentId;

  // Cells are persistent objects; each data change reassigns them so they travel instead of repainting.
  const signature = JSON.stringify([count, data.map(item => [item.id, item.value])]);
  const counts = useMemo(() => [...model.counts], [signature]); // eslint-disable-line react-hooks/exhaustive-deps
  const [layout, setLayout] = useState(() => ({ cells: reassign(Array.from({ length: count }, (_, id) => ({ id, categoryId: null, slot: id })), data, counts), moved: new Set<number>(), version: 0 }));
  const [seen, setSeen] = useState(signature);
  if (seen !== signature) {
    setSeen(signature);
    const base = Array.from({ length: count }, (_, id) => layout.cells[id] ?? { id, categoryId: null, slot: id });
    const next = reassign(base, data, counts);
    setLayout({ cells: next, moved: new Set(next.filter(cell => base[cell.id]!.slot !== cell.slot || base[cell.id]!.categoryId !== cell.categoryId).map(cell => cell.id)), version: layout.version + 1 });
  }
  const { cells, moved, version } = layout;

  const [ownActive, setOwnActive] = useState<string | null>(defaultActiveId);
  const pinned = activeId !== undefined ? activeId : ownActive;
  const setPinned = (key: string | null) => { if (activeId === undefined) setOwnActive(key); onActiveChange?.(key); };
  const [pointer, setPointer] = useState<Pointer>(null);
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => { setPointer(null); setPreview(null); }, [signature]);
  const focusKey = pointer?.categoryId ?? preview ?? pinned;
  const active = focusKey && data.some(item => item.id === focusKey) ? focusKey : null;

  const [side, setSide] = useState(0);
  useLayoutEffect(() => {
    const node = grid.current;
    if (!node) return;
    const read = () => setSide(node.clientWidth);
    read();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(read);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const gap = Math.min(GAP, side > 0 ? side / Math.max(1, columns * 2) : GAP);
  const size = side ? Math.max(0, (side - gap * (columns - 1)) / columns) : 0;
  const height = size ? size * rows + gap * (rows - 1) : 0;
  // Column by column from the bottom-left corner, like a glass filling up.
  const place = (slot: number) => ({ x: Math.floor(slot / rows) * (size + gap), y: (rows - 1 - (slot % rows)) * (size + gap) });

  const colorOf = (key: string | null) => {
    if (key === null) return "transparent";
    const index = data.findIndex(item => item.id === key), item = data[index];
    if (!item) return "transparent";
    if (item.color) return item.color;
    if(accent === null) return `color-mix(in oklab, var(--zero-arc-foreground, var(--zero-chart-foreground, var(--foreground))) ${SHADES[index % SHADES.length]}%, var(--zero-arc-surface, var(--zero-chart-surface, var(--card))))`;
    if (key === accent) return "var(--zero-arc-series-1, var(--zero-chart-blue))";
    const rank = data.filter(entry => entry.id !== accent).findIndex(entry => entry.id === key);
    return rank < 3 ? `var(--zero-arc-series-${rank + 2}, var(--zero-chart-${["purple","amber","teal"][rank]}))` : `color-mix(in oklab, var(--zero-arc-foreground, var(--zero-chart-foreground, var(--foreground))) ${SHADES[(rank - 3) % SHADES.length]}%, var(--zero-arc-surface, var(--zero-chart-surface, var(--card))))`;
  };

  const shapeOf = (key: string | null) => {
    if (key === null || key === accent) return "square";
    const rank = data.filter(entry => entry.id !== accent).findIndex(entry => entry.id === key);
    return rank < 0 ? "square" : SHAPES[rank % SHAPES.length];
  };

  // The tooltip glides between cells on its own spring and stays inside the figure.
  const tipX = useMotionValue(0), tipY = useMotionValue(0);
  const follow = { stiffness: 520, damping: 44, restDelta: .01 };
  const glideX = useSpring(tipX, follow), glideY = useSpring(tipY, follow);
  const wasShown = useRef(false);
  useLayoutEffect(() => {
    const board = grid.current;
    if (!pointer || !board || !size) { wasShown.current = false; return; }
    const { x, y } = place(pointer.slot);
    tipX.set(board.offsetLeft + x); tipY.set(board.offsetTop + y);
    if (!wasShown.current || reduced) { glideX.jump(tipX.get()); glideY.jump(tipY.get()); }
    wasShown.current = true;
  });

  const slotAt = (clientX: number, clientY: number) => {
    const box = grid.current?.getBoundingClientRect();
    if (!box || !size) return null;
    const col = clamp(Math.floor((clientX - box.left) / (size + gap)), 0, columns - 1);
    const row = clamp(Math.floor((clientY - box.top) / (size + gap)), 0, rows - 1);
    return col * rows + (rows - 1 - row);
  };
  const pointAt = (slot: number | null): Pointer => {
    if (slot === null) return null;
    const cell = cells.find(item => item.slot === slot);
    return cell?.categoryId ? { categoryId: cell.categoryId, slot } : null;
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => { if (event.pointerType === "mouse" || event.buttons) setPointer(pointAt(slotAt(event.clientX, event.clientY))); };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => { if (event.pointerType !== "mouse") event.currentTarget.setPointerCapture?.(event.pointerId); setPointer(pointAt(slotAt(event.clientX, event.clientY))); };

  // Arrows walk the grid cell by cell; Page keys jump between categories.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (empty) return;
    if (event.key === "Escape" && pointer) { event.preventDefault(); setPointer(null); return; }
    const filled = cells.filter(cell => cell.categoryId !== null).length;
    const at = pointer?.slot ?? 0;
    const col = Math.floor(at / rows), row = at % rows;
    const blocks = counts.map((size, index) => ({ start: counts.slice(0, index).reduce((sum, value) => sum + value, 0), size })).filter(block => block.size > 0);
    const block = Math.max(0, blocks.findIndex(item => at >= item.start && at < item.start + item.size));
    const moves: Record<string, () => number> = {
      ArrowUp: () => col * rows + Math.min(rows - 1, row + 1),
      ArrowDown: () => col * rows + Math.max(0, row - 1),
      ArrowRight: () => Math.min(columns - 1, col + 1) * rows + row,
      ArrowLeft: () => Math.max(0, col - 1) * rows + row,
      PageDown: () => blocks[Math.min(blocks.length - 1, block + 1)]!.start,
      PageUp: () => at > blocks[block]!.start ? blocks[block]!.start : blocks[Math.max(0, block - 1)]!.start,
      Home: () => 0,
      End: () => filled - 1,
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    setPointer(pointAt(clamp(pointer ? move() : 0, 0, Math.max(0, filled - 1))));
  };

  const format = (value: number, item: WaffleCategory) => `${formatValue ? formatValue(value, item) : grouped.format(value)}${unit ? ` ${unit}` : ""}`;
  const share = (item: WaffleCategory) => total > 0 ? Math.max(0, item.value) / total * 100 : 0;
  const reading = !empty && pointer ? data.find(item => item.id === pointer.categoryId) ?? null : null;
  const customContent = reading && renderCategoryTooltip ? renderCategoryTooltip({ category: reading, value: reading.value, share: reading.value / total, cells: counts[data.indexOf(reading)]!, slot: pointer!.slot, total }) : undefined;
  const announce = reading ? `${reading.label}, ${share(reading).toFixed(decimals)}%, ${format(reading.value, reading)}` : "";
  const summary = empty ? `${label}. ${emptyLabel}.` : `${label}. ${data.map(item => `${item.label} ${share(item).toFixed(decimals)}%`).join(", ")}.`;
  const shownX = reduced ? tipX : glideX, shownY = reduced ? tipY : glideY;
  const settle = reduced ? { duration: 0 } : spring.morph;

  return <figure data-slot="waffle-chart" data-zero-arc-chart data-motion={reduced ? "off" : undefined} ref={figure} className={[styles.figure, className].filter(Boolean).join(" ")} aria-label={label} data-legend={legend || undefined}>
    <div className={styles.body}>
    <div className={styles.board}>
      <div ref={grid} className={styles.grid} style={{ height: height || undefined, aspectRatio: height ? undefined : `${columns} / ${rows}` }} data-active={active ? true : undefined}
        role="group" tabIndex={empty ? -1 : 0} aria-roledescription="waffle chart" aria-label={`${label}. ${count} cells. Use arrow keys to move between cells, Page Up and Page Down to jump between categories.`}
        onPointerMove={onPointerMove} onPointerDown={onPointerDown} onPointerUp={event => { if (event.pointerType !== "mouse") setPointer(null); }} onPointerCancel={() => setPointer(null)} onPointerLeave={event => { if (event.pointerType === "mouse") setPointer(null); }}
        onKeyDown={onKeyDown} onBlur={() => setPointer(null)} onFocus={event => { if (event.currentTarget.matches(":focus-visible") && !empty) setPointer(current => current ?? pointAt(0)); }}>
        {size > 0 && cells.map(cell => {
          const { x, y } = place(cell.slot);
          const travel = moved.has(cell.id) && !reduced;
          const delay = reduced ? 0 : (cell.slot / count) * .32;
          const on = cell.categoryId !== null && cell.categoryId === active;
          const shown = inView || reduced;
          // A travelling cell dips while it flies, so the flow reads as cells lifting out of one block and landing in another.
          const dip = travel ? [1, .62 + (version % 2) * .001, 1] : 1;
          return <motion.span key={cell.id} className={styles.cell} aria-hidden="true"
            data-on={on || undefined} data-cursor={pointer?.slot === cell.slot || undefined} data-empty={cell.categoryId === null || undefined} data-shape={shapeOf(cell.categoryId)}
            style={{ width: size, height: size, "--zero-arc-cell": colorOf(cell.categoryId), "--zero-arc-delay": `${delay}s` } as CSSProperties}
            initial={reduced ? false : { x, y, scale: .4, opacity: 0 }}
            animate={shown ? { x, y, scale: dip, opacity: cell.categoryId === null ? 0 : 1 } : { x, y, scale: .4, opacity: 0 }}
            transition={reduced ? { duration: 0 } : {
              x: { ...settle, delay }, y: { ...settle, delay },
              scale: travel ? { duration: .62, times: [0, .42, 1], ease: motionTokens.ease.inOut, delay } : { ...spring.snappy, delay: delay * .6 },
              opacity: { duration: motionTokens.duration.standard, ease: motionTokens.ease.standard, delay: delay * .6 },
            }} />;
        })}
      </div>
      {!empty && <Tooltip open={!!reading && customContent !== null} delayDuration={0} motion="blur" arrow={false} disableHoverableContent onOpenChange={next=>{ if(!next) setPointer(null); }}>
        <TooltipTrigger asChild><motion.span className={styles.inspectionAnchor} tabIndex={-1} aria-hidden="true" style={{ x: shownX, y: shownY, width: size, height: size }} /></TooltipTrigger>
        <TooltipContent className={styles.tooltip} side="top" sideOffset={10} collisionPadding={8} updatePositionStrategy="always" arrow={false} data-shown onEscapeKeyDown={event=>{ event.preventDefault(); setPointer(null); }}>
        {customContent === undefined ? <><p className={styles.tipRow}>
          <span className={styles.tipSwatch} data-shape={shapeOf(reading?.id ?? null)} style={{ "--zero-arc-cell": colorOf(reading?.id ?? null) } as CSSProperties} />
          <span className={styles.tipName}>{reading?.label ?? ""}</span>
          <span className={styles.tipValue}>{reading ? `${share(reading).toFixed(decimals)}%` : ""}</span>
        </p>
        <p className={styles.tipMeta}>{reading ? format(reading.value, reading) : ""}</p></> : customContent}
        </TooltipContent>
      </Tooltip>}
      {empty && <p className={styles.message}>{emptyLabel}</p>}
    </div>
    {legend && !empty && <ul className={styles.legend} aria-label={`${label} categories`} onPointerLeave={() => setPreview(null)}>
      {data.map(item => <li key={item.id}>
        <button type="button" className={styles.item} aria-pressed={pinned === item.id} data-on={active === item.id || undefined} data-dim={(active !== null && active !== item.id) || undefined}
          onClick={() => setPinned(pinned === item.id ? null : item.id)}
          onPointerEnter={event => { if (event.pointerType === "mouse") setPreview(item.id); }} onFocus={event => { if (event.currentTarget.matches(":focus-visible")) setPreview(item.id); }} onBlur={() => setPreview(null)}>
          <span className={styles.swatch} data-shape={shapeOf(item.id)} style={{ "--zero-arc-cell": colorOf(item.id) } as CSSProperties} aria-hidden="true" />
          <span className={styles.itemLabel}>{item.label}</span>
          <span className={styles.itemShare}><Rolling value={share(item)} decimals={decimals} reduced={reduced} /></span>
        </button>
      </li>)}
    </ul>}
    </div>
    <p className={styles.srOnly} aria-live="polite" aria-atomic="true">{announce}</p>
    <p className={styles.srOnly}>{summary}</p>
    {!empty && <div className={styles.srOnly}><table>
      <caption>{label}</caption>
      <thead><tr><th scope="col">Category</th><th scope="col">Value</th><th scope="col">Share</th><th scope="col">Cells</th></tr></thead>
      <tbody>{data.map((item, index) => <tr key={item.id}><th scope="row">{item.label}</th><td>{format(item.value, item)}</td><td>{share(item).toFixed(decimals)}%</td><td>{counts[index]}</td></tr>)}</tbody>
    </table></div>}
  </figure>;
}

export default WaffleChart;
