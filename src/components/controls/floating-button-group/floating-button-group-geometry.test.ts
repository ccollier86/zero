/** Pure screen-to-tray geometry qualification; no browser globals/provider. */
import { describe, expect, test } from 'bun:test';
import {
  isFloatingButtonGroupAxisAlignedTransform, resolveFloatingButtonGroupGeometry,
  type FloatingButtonGroupMeasurement,
} from './floating-button-group-geometry';

const measurement: FloatingButtonGroupMeasurement = {
  ownerRect: { left: 100, top: 50, width: 200, height: 40 },
  targetRect: { left: 120, top: 56, width: 36, height: 28 },
  ownerOffsetWidth: 200, ownerOffsetHeight: 40,
  ownerClientLeft: 1, ownerClientTop: 2, scrollLeft: 0, scrollTop: 0,
  devicePixelRatio: 1, transforms: ['none'],
};

describe('floating highlight geometry', () => {
  test('native padding-box coordinates account for borders and both scroll axes', () => {
    expect(resolveFloatingButtonGroupGeometry(measurement)).toEqual({ x: 19, y: 4, width: 36, height: 28 });
    expect(resolveFloatingButtonGroupGeometry({ ...measurement, scrollLeft: 17, scrollTop: 9 }))
      .toEqual({ x: 36, y: 13, width: 36, height: 28 });
    expect(resolveFloatingButtonGroupGeometry({ ...measurement, scrollLeft: -17 }))
      .toEqual({ x: 2, y: 4, width: 36, height: 28 });
  });

  test('independent positive axis scale recovers stationary target dimensions', () => {
    expect(resolveFloatingButtonGroupGeometry({ ...measurement,
      ownerRect: { left: 100, top: 50, width: 300, height: 20 },
      targetRect: { left: 130, top: 53, width: 54, height: 14 },
      transforms: ['matrix(1.5, 0, 0, .5, 0, 0)'],
    })).toEqual({ x: 19, y: 4, width: 36, height: 28 });
    expect(resolveFloatingButtonGroupGeometry({ ...measurement,
      ownerRect: { left: 100, top: 50, width: 100, height: 20 },
      targetRect: { left: 110, top: 53, width: 18, height: 14 },
      transforms: ['matrix(.5, 0, 0, .5, 0, 0)', 'matrix(1, 0, 0, 1, 20, 30)'],
    })).toEqual({ x: 19, y: 4, width: 36, height: 28 });
  });

  test('fractional DPR snaps screen edges before converting scale and positions', () => {
    const result = resolveFloatingButtonGroupGeometry({ ...measurement,
      ownerRect: { left: 100.25, top: 50.2, width: 250, height: 30 },
      targetRect: { left: 126.21, top: 54.18, width: 44.31, height: 20.27 },
      devicePixelRatio: 1.25,
    });
    expect(result?.x).toBeCloseTo((126.4 - 100.25) / 1.25 - 1, 8);
    expect(result?.y).toBeCloseTo((54.4 - 50.2) / .75 - 2, 8);
    expect(result?.width).toBeCloseTo((170.4 - 126.4) / 1.25, 8);
    expect(result?.height).toBeCloseTo((74.4 - 54.4) / .75, 8);
    for (const dpr of [0, -1, NaN, Infinity]) {
      expect(resolveFloatingButtonGroupGeometry({ ...measurement, devicePixelRatio: dpr }))
        .toEqual(resolveFloatingButtonGroupGeometry(measurement));
    }
  });

  test('invalid/disconnected geometry fails closed without poisoning native interactions', () => {
    for (const field of ['ownerOffsetWidth', 'ownerOffsetHeight'] as const) {
      for (const value of [0, -1, NaN, Infinity]) {
        expect(resolveFloatingButtonGroupGeometry({ ...measurement, [field]: value })).toBeNull();
      }
    }
    for (const field of ['ownerClientLeft', 'ownerClientTop'] as const) {
      expect(resolveFloatingButtonGroupGeometry({ ...measurement, [field]: -1 })).toBeNull();
    }
    for (const rect of ['ownerRect', 'targetRect'] as const) {
      for (const field of ['width', 'height'] as const) {
        for (const value of [0, -1, NaN, Infinity]) {
          expect(resolveFloatingButtonGroupGeometry({ ...measurement, [rect]: { ...measurement[rect], [field]: value } })).toBeNull();
        }
      }
      for (const field of ['left', 'top'] as const) {
        expect(resolveFloatingButtonGroupGeometry({ ...measurement, [rect]: { ...measurement[rect], [field]: NaN } })).toBeNull();
      }
    }
    expect(resolveFloatingButtonGroupGeometry({ ...measurement, targetRect: { ...measurement.targetRect, width: .001 } })).toBeNull();
    expect(resolveFloatingButtonGroupGeometry({ ...measurement, transforms: ['matrix(0, 1, -1, 0, 0, 0)'] })).toBeNull();
    expect(resolveFloatingButtonGroupGeometry({ ...measurement, transforms: ['none', 'rotate(0.5turn)'] })).toBeNull();
  });
});

describe('bounded transform admission', () => {
  test('computed positive affine axes and translations are accepted', () => {
    for (const input of ['', 'none', 'matrix(1,0,0,1,10,-8)', 'matrix(.8, 0, 0, 1.2, 0, 0)',
      'matrix(1, 0.000000001, -0.000000001, 1, 0, 0)',
      'matrix3d(1,0,0,0,0,2,0,0,0,0,1,0,10,-8,0,1)']) {
      expect(isFloatingButtonGroupAxisAlignedTransform(input)).toBe(true);
    }
  });

  test('rotation/skew/reflection/perspective/malformed transforms reject decorative paint', () => {
    for (const input of ['matrix(1,.1,0,1,0,0)', 'matrix(1,0,.1,1,0,0)', 'matrix(-1,0,0,1,0,0)',
      'matrix(1,0,0,0,0,0)', 'matrix(1,0,0,1,Infinity,0)', 'matrix(1,0,0,1,0)',
      'matrix3d(1,0,0,.001,0,1,0,0,0,0,1,0,0,0,0,1)',
      'matrix3d(1,0,0,0,0,1,0,0,0,0,-1,0,0,0,0,1)',
      'matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,2)',
      'rotate(1deg)', 'scale(2)', 'translateX(1px)', 'bogus', 'matrix(1,,0,1,0,0)']) {
      expect(isFloatingButtonGroupAxisAlignedTransform(input)).toBe(false);
    }
  });
});
