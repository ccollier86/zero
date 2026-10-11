/** Old UI imports forward to one canonical Select/context and helper implementation. */
import { expect, test } from 'bun:test';
import * as legacy from '../../ui/select';
import * as canonical from './select';
import * as legacyGeometry from '../../ui/select-motion-geometry';
import * as geometry from './select-motion-geometry';
import { selectPaintCopy as oldPaint } from '../../ui/select-paint';
import { selectPaintCopy } from './select-paint';

test('legacy and canonical Select entries preserve component and pure-helper identity', () => {
  for (const name of ['Select','SelectContent','SelectGroup','SelectItem','SelectLabel','SelectScrollDownButton',
    'SelectScrollUpButton','SelectSeparator','SelectTrigger','SelectValue'] as const) expect(legacy[name]).toBe(canonical[name]);
  for (const name of ['selectMotionTime','stepSelectSpring','selectTriggerClip','selectLocalTriggerClip',
    'selectDepartureTarget','selectClipCss','readSelectClip'] as const) expect(legacyGeometry[name]).toBe(geometry[name]);
  expect(oldPaint).toBe(selectPaintCopy);
});

test('the retained Select stylesheet points at its canonical family skin', async () => {
  expect(await Bun.file(new URL('../../ui/select-morph.css',import.meta.url)).text())
    .toContain('@import "../controls/select/select-morph.css";');
});
