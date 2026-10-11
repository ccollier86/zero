/**
 * Validated hierarchy and squarified area math adapted from Arc Free (MIT),
 * copyright 2026 Elia Kuratli. Branch sizes sum admitted leaves; color is the
 * leaf-size weighted mean. Pure presentation data, never database authority.
 */
import { ARC_DISTRIBUTION_LIMITS as LIMITS, ownArray, ownNumber, ownRecord, ownString, uniqueId, requireKeys, optionNumber } from "../streamgraph/distribution-admission";
export interface TreemapNode {
  /** Stable identity, unique in the tree. A tile that survives a data change morphs to its new size. */
  id: string;
  label: string;
  /** Leaf size. A branch's size is the sum of its children. */
  value?: number;
  /** Optional second measure for shading, such as growth. A branch uses the size weighted mean of its children. */
  color?: number;
  children?: readonly TreemapNode[];
}


export type TreemapRect = { x: number; y: number; w: number; h: number };
export type TreemapFlat = { id: string; label: string; value: number; color: number | null; depth: number; parent: string | null; children: string[]; path: string[] };
export type TreemapDrawn = TreemapRect & { o: number };


const GAP=2,PAD=3,HEADER=22;
const inset=(r:TreemapRect,top:number,side:number):TreemapRect=>({x:r.x+side,y:r.y+top,w:Math.max(0,r.w-side*2),h:Math.max(0,r.h-top-side)});
function flattenAdmitted(root: TreemapNode) {
  const flat = new Map<string, TreemapFlat>();
  const visit = (node: TreemapNode, depth: number, parent: string | null, path: string[]): { value: number; weighted: number; colored: number } => {
    const kids = node.children ?? [];
    let value = 0, weighted = 0, colored = 0;
    if (kids.length) for (const kid of kids) { const r = visit(kid, depth + 1, node.id, depth === 0 ? [] : [...path, node.label]); value += r.value; weighted += r.weighted; colored += r.colored; }
    else { value = Math.max(0, node.value ?? 0); if (node.color !== undefined && Number.isFinite(node.color)) { weighted = node.color * value; colored = value; } }
    flat.set(node.id, { id: node.id, label: node.label, value, color: colored ? weighted / colored : null, depth, parent, children: kids.map(kid => kid.id), path: depth === 0 ? [node.label] : [...path, node.label] });
    return { value, weighted, colored };
  };
  visit(root, 0, null, []);
  return flat;
}

/** Squarified layout: rows of tiles along the short side, each row closed when adding a tile would make the worst aspect ratio worse. */
export function squarifyTreemap(input: readonly Readonly<{ id: string; value: number }>[], rectangle: Readonly<TreemapRect>, out: Map<string, TreemapRect>) {
  const ids = new Set<string>();
  const items = ownArray(input, LIMITS.treeNodes, "Treemap layout items").map(value => {
    const item = ownRecord(value, "Treemap layout item");
    requireKeys(item, ["id", "value"], "Treemap layout item");
    return { id: uniqueId(item.id, ids, "Treemap layout id"), value: ownNumber(item.value, "Treemap layout value", true) };
  });
  const geometry = ownRecord(rectangle, "Treemap rectangle");
  requireKeys(geometry, ["x", "y", "w", "h"], "Treemap rectangle");
  const rect: TreemapRect = {
    x: ownNumber(geometry.x, "Treemap x"), y: ownNumber(geometry.y, "Treemap y"),
    w: optionNumber(ownNumber(geometry.w, "Treemap width"), 0, 0, 16384, "Treemap width"),
    h: optionNumber(ownNumber(geometry.h, "Treemap height"), 0, 0, 16384, "Treemap height"),
  };
  // The explicit output target is a genuine Map; inherited overrides are not input callbacks.
  const put = (id: string, value: TreemapRect) => Map.prototype.set.call(out, id, value);
  const has = (id: string): boolean => Map.prototype.has.call(out, id);
  has("");
  let list = items.filter(item => item.value > 0).sort((a, b) => b.value - a.value);
  const total = list.reduce((sum, item) => sum + item.value, 0);
  if(total>LIMITS.magnitude)throw new RangeError("Treemap layout aggregate exceeds 1e12");
  if (!total || rect.w <= 0 || rect.h <= 0) { for (const item of items) put(item.id, { x: rect.x, y: rect.y, w: 0, h: 0 }); return; }
  const area = rect.w * rect.h;
  const areaOf = (value:number) => value / total * area;
  // Below representable screen area, retain the exact table value but no tile.
  list=list.filter(item=>areaOf(item.value)>0);
  let { x, y, w, h } = rect, i = 0;
  const worst = (row: number[], side: number) => { const sum = row.reduce((a, b) => a + b, 0), max = Math.max(...row), min = Math.min(...row); return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min)); };
  while (i < list.length) {
    if (w <= 1e-9 || h <= 1e-9) break;
    const side = Math.min(w, h), row: number[] = [areaOf(list[i]!.value)];
    let j = i + 1;
    while (j < list.length) { const next = [...row, areaOf(list[j]!.value)]; if (worst(next, side) > worst(row, side)) break; row.push(areaOf(list[j]!.value)); j++; }
    const sum = row.reduce((a, b) => a + b, 0);
    if (w >= h) { const cw = sum / h; let cy = y; for (let k = i; k < j; k++) { const th = (areaOf(list[k]!.value)) / cw; put(list[k]!.id, { x, y: cy, w: cw, h: th }); cy += th; } x += cw; w -= cw; }
    else { const rh = sum / w; let cx = x; for (let k = i; k < j; k++) { const tw = (areaOf(list[k]!.value)) / rh; put(list[k]!.id, { x: cx, y, w: tw, h: rh }); cx += tw; } y += rh; h -= rh; }
    i = j;
  }
  for (const item of items) if (!has(item.id)) put(item.id, { x: rect.x, y: rect.y, w: 0, h: 0 });
}

/** Rects of every descendant when `focus` fills the view: its children fill the view, and each branch holds its own children under a header. */
export function computeTreemapLayout(flat: Map<string, TreemapFlat>, focus: string, view: TreemapRect) {
  const out = new Map<string, TreemapRect>();
  const nest = (id: string, rect: TreemapRect, top: boolean) => {
    const node = flat.get(id)!;
    if (!node.children.length) return;
    const room = top ? rect : inset(rect, rect.h > 48 && rect.w > 64 ? HEADER : PAD, PAD);
    const placed = new Map<string, TreemapRect>();
    squarifyTreemap(node.children.map(child => ({ id: child, value: flat.get(child)!.value })), room, placed);
    for (const [child, r] of placed) { const gapped = { x: r.x + GAP / 2, y: r.y + GAP / 2, w: Math.max(0, r.w - GAP), h: Math.max(0, r.h - GAP) }; out.set(child, gapped); nest(child, gapped, false); }
  };
  nest(focus, view, true);
  return out;
}
/** The affine map that carries rect `from` onto rect `to`, applied to `r`. */
export const carryTreemapRect = (r: TreemapRect, from: TreemapRect, to: TreemapRect): TreemapRect => { const sx = to.w / (from.w || 1), sy = to.h / (from.h || 1); return { x: to.x + (r.x - from.x) * sx, y: to.y + (r.y - from.y) * sy, w: r.w * sx, h: r.h * sy }; };


/** Reject cycles/aliasing, duplicate IDs, unknown fields and excessive trees before flattening. */
export function buildTreemapModel(input: TreemapNode): Map<string,TreemapFlat> {
 const seen=new WeakSet<object>(),ids=new Set<string>();let count=0;
 const visit=(value:unknown,depth:number):TreemapNode=>{
 const r=ownRecord(value,"Treemap node");requireKeys(r,["id","label","value","color","children"],"Treemap node");
 if(depth>LIMITS.treeDepth||++count>LIMITS.treeNodes)throw new RangeError("Treemap exceeds 2048 nodes or 16 levels");
 if(seen.has(value as object))throw new TypeError("Treemap contains a cycle or aliased node");seen.add(value as object);
 const id=uniqueId(r.id,ids,"Treemap id"),label=ownString(r.label,"Treemap label");
 const kids=r.children===undefined?[]:ownArray(r.children,LIMITS.treeNodes,"Treemap children").map(child=>visit(child,depth+1));
 if(kids.length&&(r.value!==undefined||r.color!==undefined))throw new TypeError("Treemap branches derive value and color from their leaves");
 return Object.freeze({id,label,...(kids.length?{children:Object.freeze(kids) as unknown as TreemapNode[]}:{value:r.value===undefined?0:ownNumber(r.value,"Treemap value",true),...(r.color===undefined?{}:{color:ownNumber(r.color,"Treemap color")})})});
 };
 const root=visit(input,0),model=flattenAdmitted(root);
 for(const node of model.values()){if(!Number.isFinite(node.value)||node.value>LIMITS.magnitude)throw new RangeError("Treemap aggregate exceeds 1e12");Object.freeze(node.children);Object.freeze(node.path);Object.freeze(node);}
 return model;
}
/** Return a safe branch identity; missing or leaf focus falls back to root. */
export function normalizeTreemapFocus(model:ReadonlyMap<string,TreemapFlat>,id:string|undefined):TreemapFlat {
 const root=[...model.values()].find(node=>node.parent===null)!;const candidate=id?model.get(id):undefined;return candidate?.children.length?candidate:root;
}
