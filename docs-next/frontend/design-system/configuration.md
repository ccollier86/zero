---
id: zero.design-system.configuration
type: reference
audience: [developer, agent, operator]
owner: design-system
status: draft
visibility: internal
system: design-system
feature: configuration
maturity: supported
applies_to: ["2.1.1 source; publication qualification pending"]
modes: ["React browser UI", "SSR markup", "managed frontend styling"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Design-System Configuration And Defaults

[Design-system index](./index.md) · [Documentation index](../../index.md)

Presentation configuration resolves in React/CSS, not an env/Doctor settings
store. Import the public stylesheet in an app-owned pipeline or use managed
server styling; [style build](./style-build.md) owns that distinction.

## ThemeProvider

ThemeProviderProps are the installed next-themes provider props.
Zero defaults `attribute="class"`, `defaultTheme="system"`, enableSystem=true,
and disableTransitionOnChange=true. Caller props spread afterward and override
defaults. Persistence/storageKey/forcedTheme/value/nonce and other inherited
options follow that exact dependency; they do not become server auth settings.
Use class-based dark selection unless your replacement CSS explicitly supports
another attribute scheme. Do not render server-derived authority from theme.

## ThemeTogglerButton

| Prop | Default / role |
| --- | --- |
| modes | light, dark, system in that order; empty list falls back to default |
| variant / size | default/default from its icon-button variant definitions |
| direction | ltr; also rtl, ttb, btt transition fallback directions |
| onImmediateChange | optional callback before theme transition/commit |
| button type | button |
| title / aria-label | next-theme action label unless supplied |
| disabled / aria-busy | transitioning disables button and marks busy; caller props remain supported |
| onClick | caller runs first; preventDefault prevents the toggle |

[Themes](./themes.md) explains resolved versus selected theme and animation
fallbacks. A shell chooses placement; the switch is not automatically injected
into every page.

## Animated Icons

Shared props: animate/animateOnHover/animateOnTap/animateOnView default false;
animation default; animateOnViewMargin 0px; animateOnViewOnce true; loop false;
loopDelay/delay zero milliseconds; initialOnAnimateEnd/completeOnStop/
persistOnAnimateEnd false; AnimateIcon asChild false. IconWrapper size defaults
to28; CSS classes/caller size can control presentation.

[Icon animation](./icon-animation.md) owns trigger/variant/inheritance semantics,
including the corrected working-source retention forwarding. [Registry](./icon-registry.md)
owns name admission. No server provider setting or automatic Guardian policy is
associated with an icon.

CSS tokens resolve through cascade/root dark class at render time. Caller token
overrides are deliberate UI theme customization; app configuration resolution
does not validate contrast. [Tokens](./tokens.md) is the full variable reference.
