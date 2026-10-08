---
id: zero.frontend.modals.motion
type: reference
audience: [developer, agent]
owner: modals
status: draft
visibility: internal
system: modals
feature: motion
maturity: supported
applies_to: ["2.6.0 source; structured-modal upgrade unreleased"]
modes: [browser, standalone, Guardian single, Guardian multi, single-database, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "1b5a1fa0281deba69b3809471d2467d596516e4b"
  snapshot: dirty
  date: "2026-10-08"
  evidence_level: source-observed
---

# Modal Motion: Presets, Pace And Theme Control

[Modals index](./index.md) · [Documentation index](../../index.md)

The unreleased motion library preserves the supplied Motion Lab's exact curves,
keyframes and timing relationships. It does not transplant the lab's palette,
fonts or layout. Applications choose a small validated profile rather than
implementing animation ownership for each dialog.

## Defaults And Options

~~~ts
import type { ModalMotionOptions } from "@zero/framework/modals";

export const modalMotion = {
  entrance: "origin",
  exit: "mirror",
  backdrop: "blur",
  pageRecedes: true,
  durationMultiplier: 1.5,
} satisfies ModalMotionOptions;
~~~

| Option | Default / allowed values |
| --- | --- |
| entrance | origin; rise/grow/origin/spring/focus/drop |
| exit | mirror; mirror/fade |
| backdrop | blur; dim/blur |
| pageRecedes | true; boolean |
| durationMultiplier | 1.5; finite number 0.5–2.5 |

**Origin uses the actual supplied trigger; it falls back to Rise**, not Grow.
Use `trigger:event.currentTarget` when opening from a control. Programmatic
opens deliberately do not infer the last focused control. Trigger bounds must be
current, visible, connected, finite/nonzero and in the dialog's document. A Rise
fallback retains its paired Rise exit even if a trigger appears later. An actual
origin entrance losing its trigger also uses Rise's exit instead of stale geometry.

`mirror` means the tuned paired exit, not mathematically reversing entrance
keyframes. `fade` chooses the independent Quick fade exit: opacity to 0 and
scale to .98, not a pure fade.

## Pace, Not Velocity

The lab's “Speed” multiplies duration: `round(baseMs × durationMultiplier)`.
**1.5 is slower**, not 1.5 times faster. 975ms is 650×1.5, never a base multiplied
again. Entrance/opacity/content/exit/backdrop/recession/stack/tab presentation all
scale together. 120ms control feedback, validation/retry/request timers and the real
1500ms hold-to-confirm interval do not scale.

Motion is not an action delay. Accessible content mounts, focus moves and domain
work can begin while entrance presentation runs.

## Exact Presets At Multiplier One

| Entrance | Initial transform/effect → settled | Enter / fade | Paired exit |
| --- | --- | --- | --- |
| Rise | translateY(18px) + scale(.98) → none; SPRING | 600/260ms | translateY(10px) + scale(.98), opacity 0; 260ms IN |
| Grow | scale(.86) → none; OUT | 500/240ms | scale(.92), opacity 0; 240ms IN |
| From button (origin) | trigger-relative translation + independent X/Y scale; SPRING | 650ms shell; 220ms inner | Return to current trigger; 380ms OUT |
| Spring | scale(.72) → none; BOUNCY | 700/200ms | scale(.9), opacity 0; 220ms IN |
| Focus | scale(1.06) + blur(12px) → none/blur(0); SOFT | 560/300ms | scale(1.03) + blur(8px), opacity 0; 260ms IN |
| Drop | translateY(−36px) → none; SPRING | 600/240ms | translateY(−16px), opacity 0; 240ms IN |

Ordinary entrance fades use OUT. Quick fade is 180ms base, OUT. Focus filter
support degrades to transform/opacity without breaking the lifecycle.

## Approved Default Timing Breakdown

| Effect | Base | 1.5 default |
| --- | --- | --- |
| Origin transform enter | 650ms | 975ms |
| Origin shell opacity enter | 140ms | 210ms |
| Origin content delay / fade | 160/220ms | 240/330ms |
| Origin shell return / inner exit fade | 380/120ms | 570/180ms |
| Rise fallback enter / fade / exit | 600/260/260ms | 900/390/390ms |
| Backdrop in / out, linear | 320/260ms | 480/390ms |
| Page recede / restore | 600/420ms | 900/630ms |
| Stack step-back, OUT | 450ms | 675ms |
| Tab/nav movement, OUT | 350ms | 525ms |

Origin shell return and inner exit fade start **concurrently**. The shell reaches
its target at offset .85 with opacity .9, then fades to 0 at the same target; an
interrupted partially visible entrance never flashes brighter during return.
The page restore can outlast the shell exit, so the host reserves its shared scene
until complete cleanup without delaying logical acceptance.

## Curves And Effect Amounts

OUT is `cubic-bezier(.2,0,0,1)`; IN is `cubic-bezier(.4,0,1,1)`;
SOFT is `cubic-bezier(.16,1,.3,1)`. Sampled curves are exact:

~~~text
SPRING = linear(0, .0258, .09, .1763, .2732, .3724, .4683, .5573, .6376, .7082, .7689, .8202, .8628, .8976, .9256, .9476, .9648, .9778, .9875, .9945, .9994, 1.0026, 1.0047, 1.0058, 1.0062, 1.0062, 1.0059, 1.0055, 1.0049, 1.0043, 1.0036, 1.0031, 1.0025, 1.002, 1.0016, 1.0013, 1)
BOUNCY = linear(0, .133, .41, .697, .918, 1.05, 1.1, 1.091, 1.05, 1.006, .978, .968, .973, .986, .999, 1.006, 1.007, 1.004, 1.001, 1)
~~~

Unsupported linear() uses only the specified fallbacks:
`cubic-bezier(.22,1.2,.36,1)` and `cubic-bezier(.34,1.56,.64,1)`.
It does not replace the curves with a motion-library spring.

Dim+blur keeps 6px backdrop blur while opacity fades; unsupported backdrop-filter
falls back to dim. Page recession is scale(.965), origin 50% 30vh, semantic radius.
Lower modal layers use −12px translation and .04 scale reduction per depth, bounded
to safe geometry. Position, stack and shell transforms belong to separate elements.

## Precedence, Interruptions And Reduced Motion

Inherited `--zero-modal-*` CSS values form the theme defaults; host motion settings
and explicit call settings override them. Instance presentation snapshots avoid
a global configuration change replaying every open dialog. Owned updates/retargets
must start from current composited state rather than snapping to an assumed start.
Provider defaults are captured per opening; a later provider change applies to
new dialogs. An explicit instance motion update may retarget in-flight owned
effects or change its later exit without replaying a settled entrance.
The live reduced-motion preference always overrides presentation: approximately
1ms transitions, no origin travel, overshoot or page recession, and no prolonged
fade. Safety holds keep real elapsed time.

For measured content whose ancestor geometry must remain stable (such as the
shared avatar cropper), a feature may deliberately choose a zero-travel Rise,
quick fade and no page recession through local motion/geometry tokens. That is
an explicit measured-editor override, not a changed global modal default.

Use MODAL_MOTION_DEFAULTS/TIMINGS/EASING/GEOMETRY and resolveModalMotion for
advanced presentation tooling; these are not authorization or persistence APIs.
The default stylesheet includes matching CSS variables independently of table or
calendar CSS. Theme tokens control effect amounts, surfaces, fonts, borders,
radii, glyph/target sizes and dimensions. Avoid per-feature palette forks.

## Related Guides And Next Steps

[Host](./modal-manager.md) owns shared scene leases; [configuration](./configuration.md)
lists instance settings; [layouts](./layouts.md) owns panel geometry;
[hold safety](./hold-button.md) distinguishes motion from deliberate confirmation.
