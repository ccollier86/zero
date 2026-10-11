/** Pure Zero chart presentation constants; no browser clock or renderer dependency. */
import { motionTokens } from '../../arc/shared/motion-tokens';
const morphRoot = 2 * Math.PI / (motionTokens.spring.morph.visualDuration * 1.2);
/** Preserve the existing 420ms morph spring vocabulary with physical coefficients that retain velocity. */
export const NATIVE_CHART_MOTION = Object.freeze({ morph: Object.freeze({ type: 'spring' as const, stiffness: morphRoot ** 2, damping: 2 * (1 - motionTokens.spring.morph.bounce) * morphRoot }), reveal: motionTokens.duration.considered * 1.75, feedback: motionTokens.duration.instant });
