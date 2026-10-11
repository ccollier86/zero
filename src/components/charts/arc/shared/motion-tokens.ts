/**
 * Zero Arc-derived chart motion presets. These presentation constants preserve
 * the free reference's spring/easing vocabulary; they own no clocks or data.
 *
 * Derived from Arc UI. Copyright (c) 2026 Elia Kuratli.
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
export const motionTokens = {
  duration: { instant: .12, fast: .16, exit: .18, standard: .24, considered: .48 },
  ease: { enter: [.16, 1, .3, 1], exit: [.7, 0, .84, 0], standard: [.22, 1, .36, 1], inOut: [.65, 0, .35, 1] },
  spring: {
    responsive: { type: 'spring', stiffness: 520, damping: 38 },
    gentle: { type: 'spring', stiffness: 340, damping: 34 },
    snappy: { type: 'spring', visualDuration: .26, bounce: .12 },
    smooth: { type: 'spring', visualDuration: .4, bounce: 0 },
    morph: { type: 'spring', visualDuration: .42, bounce: .16 },
  },
  stagger: { char: .016, word: .04, line: .08, item: .035 },
  blur: { subtle: 2, soft: 4, text: 8 },
} as const;

// These literals are public reference defaults, not a mutable global settings
// service. Freeze their nested groups so one consumer cannot retune siblings.
for (const group of Object.values(motionTokens)) {
  for (const item of Object.values(group)) if (typeof item === 'object' && item !== null) Object.freeze(item);
  Object.freeze(group);
}
Object.freeze(motionTokens);

/** The public reference motion defaults; settings describe presentation, not business-event time. */
export const ARC_CHART_MOTION_DEFAULTS = motionTokens;
