---
id: zero.design-system.tokens
type: reference
audience: [developer, agent, operator]
owner: design-system
status: draft
visibility: internal
system: design-system
feature: tokens
maturity: supported
applies_to: ["2.1.1 source; publication qualification pending"]
modes: ["React browser UI", "SSR markup", "managed frontend styling"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Semantic Tokens And Exact Source Values

[Design-system index](./index.md) · [Documentation index](../../index.md)

`@zero/framework/styles.css` exports the source stylesheet. Managed styling
compiles it with Tailwind; standalone apps may import it through their own
supported CSS pipeline. Values below come from the inspected root/.dark blocks,
not a contrast-certification result.

## Tailwind Aliases

Tailwind adds the utility prefix to each color alias. The descriptive aliases
therefore deliberately include a second bg/text word in their class names:

| Theme alias | Example utility | Semantic value |
| --- | --- | --- |
| --color-bg-base | bg-bg-base | --background |
| --color-bg-surface | bg-bg-surface | --surface |
| --color-bg-raised | bg-bg-raised | --surface-raised |
| --color-bg-inset | bg-bg-inset | --surface-inset |
| --color-text-primary | text-text-primary | --foreground |
| --color-text-secondary | text-text-secondary | --muted-foreground |
| --color-text-muted | text-text-muted | --subtle-foreground |
| --color-border | border-border | --border |
| --color-border-strong | border-border-strong | --border-strong |

The conventional background/foreground/card/popover/primary/secondary/muted/
accent/success/warning/destructive/input/ring aliases also map directly to their
corresponding variable: for example bg-background, text-foreground and
text-primary. **text-primary is the primary accent color**, not the descriptive
primary-text/foreground alias.

Public utilities map public-background/foreground/surface/surface-foreground/
surface-raised/glass/glass-foreground/muted/muted-foreground/accent/
accent-foreground/accent-soft/border/ring. Sidebar utilities include sidebar
(and sidebar-background alias), sidebar-foreground/primary/primary-foreground/
accent/accent-foreground/border/ring. Chart color utilities map chart-1 through5.

font-sans/font-mono use platform font stacks. radius-sm = radius minus2px,
radius-md = radius, radius-lg = radius plus2px, radius-xl = radius plus6px.
public-shadow-floating is a CSS variable, not an automatically declared
Tailwind shadow utility.

## Root And Dark Values

| CSS custom property | Light/root | Dark |
| --- | --- | --- |
| `--font-platform-sans` | `Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol"` | `inherits light/root` |
| `--font-platform-mono` | `"SF Mono", "Cascadia Code", "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace` | `inherits light/root` |
| `--radius` | `0.375rem` | `inherits light/root` |
| `--background` | `oklch(98.2% 0.007 247)` | `oklch(16.5% 0.018 255)` |
| `--foreground` | `oklch(20.5% 0.026 255)` | `oklch(94.8% 0.008 247)` |
| `--surface` | `oklch(96.5% 0.01 247)` | `oklch(20.4% 0.023 255)` |
| `--surface-raised` | `oklch(100% 0 0)` | `oklch(24.8% 0.028 255)` |
| `--surface-inset` | `oklch(94.6% 0.012 247)` | `oklch(13.5% 0.017 255)` |
| `--card` | `oklch(100% 0 0)` | `oklch(20.8% 0.024 255)` |
| `--card-foreground` | `var(--foreground)` | `var(--foreground)` |
| `--popover` | `oklch(100% 0 0)` | `oklch(22.5% 0.027 255)` |
| `--popover-foreground` | `var(--foreground)` | `var(--foreground)` |
| `--primary` | `oklch(53.2% 0.19 257)` | `oklch(65% 0.17 257)` |
| `--primary-foreground` | `oklch(99% 0 0)` | `oklch(14% 0.02 257)` |
| `--secondary` | `oklch(92.8% 0.013 247)` | `oklch(26.2% 0.028 255)` |
| `--secondary-foreground` | `oklch(27.7% 0.032 255)` | `oklch(91.5% 0.01 247)` |
| `--muted` | `oklch(94.2% 0.011 247)` | `oklch(26.2% 0.028 255)` |
| `--muted-foreground` | `oklch(48.5% 0.028 255)` | `oklch(69.8% 0.019 247)` |
| `--subtle-foreground` | `oklch(62.5% 0.024 255)` | `oklch(55.4% 0.021 247)` |
| `--accent` | `oklch(92.4% 0.034 257)` | `oklch(28.5% 0.044 257)` |
| `--accent-hover` | `oklch(89.5% 0.046 257)` | `oklch(33.5% 0.061 257)` |
| `--accent-foreground` | `oklch(29.5% 0.089 257)` | `oklch(91.5% 0.025 257)` |
| `--success` | `oklch(60.4% 0.151 151)` | `oklch(68.8% 0.145 151)` |
| `--success-foreground` | `oklch(99% 0 0)` | `oklch(14% 0.03 151)` |
| `--warning` | `oklch(75.4% 0.151 73)` | `oklch(78.2% 0.145 73)` |
| `--warning-foreground` | `oklch(24% 0.04 73)` | `oklch(16% 0.03 73)` |
| `--destructive` | `oklch(60.2% 0.208 25)` | `oklch(66.5% 0.196 25)` |
| `--destructive-foreground` | `oklch(99% 0 0)` | `oklch(99% 0 0)` |
| `--border` | `oklch(86.4% 0.018 247)` | `oklch(34.2% 0.032 255)` |
| `--border-strong` | `oklch(76.8% 0.025 247)` | `oklch(43.2% 0.036 255)` |
| `--input` | `oklch(84.8% 0.019 247)` | `oklch(27.8% 0.03 255)` |
| `--ring` | `oklch(57% 0.18 257)` | `oklch(68% 0.16 257)` |
| `--sidebar` | `oklch(96.7% 0.009 247)` | `oklch(18.8% 0.021 255)` |
| `--sidebar-foreground` | `var(--foreground)` | `var(--foreground)` |
| `--sidebar-primary` | `var(--primary)` | `var(--primary)` |
| `--sidebar-primary-foreground` | `var(--primary-foreground)` | `var(--primary-foreground)` |
| `--sidebar-accent` | `oklch(92.8% 0.013 247)` | `oklch(25.5% 0.028 255)` |
| `--sidebar-accent-foreground` | `var(--foreground)` | `var(--foreground)` |
| `--sidebar-border` | `var(--border)` | `var(--border)` |
| `--sidebar-ring` | `var(--ring)` | `var(--ring)` |
| `--chart-1` | `oklch(56.6% 0.19 257)` | `oklch(67.6% 0.17 257)` |
| `--chart-2` | `oklch(59.5% 0.17 305)` | `oklch(70.5% 0.15 305)` |
| `--chart-3` | `oklch(61.2% 0.145 151)` | `oklch(72.5% 0.135 151)` |
| `--chart-4` | `oklch(72.6% 0.155 73)` | `oklch(80% 0.13 73)` |
| `--chart-5` | `oklch(63.4% 0.19 12)` | `oklch(72.5% 0.155 12)` |
| `--public-background` | `oklch(98.8% 0.009 255)` | `oklch(11.8% 0.019 260)` |
| `--public-foreground` | `oklch(17.5% 0.028 257)` | `oklch(96.8% 0.006 250)` |
| `--public-surface` | `oklch(100% 0 0)` | `oklch(16.8% 0.022 260)` |
| `--public-surface-foreground` | `var(--public-foreground)` | `var(--public-foreground)` |
| `--public-surface-raised` | `oklch(99.4% 0.006 255)` | `oklch(20.2% 0.026 260)` |
| `--public-glass` | `oklch(100% 0 0 / 0.76)` | `oklch(13.8% 0.021 260 / 0.82)` |
| `--public-glass-foreground` | `var(--public-foreground)` | `var(--public-foreground)` |
| `--public-muted` | `oklch(94.6% 0.013 255)` | `oklch(24% 0.025 260)` |
| `--public-muted-foreground` | `oklch(48% 0.027 257)` | `oklch(74.5% 0.018 250)` |
| `--public-accent` | `oklch(57.5% 0.205 262)` | `oklch(67% 0.19 258)` |
| `--public-accent-foreground` | `oklch(99% 0 0)` | `oklch(13% 0.022 258)` |
| `--public-accent-soft` | `oklch(92% 0.041 262 / 0.92)` | `oklch(100% 0 0 / 0.1)` |
| `--public-border` | `oklch(85.4% 0.02 255 / 0.8)` | `oklch(100% 0 0 / 0.12)` |
| `--public-ring` | `oklch(63% 0.19 262)` | `oklch(70% 0.17 258)` |
| `--public-shadow-floating` | `0 0 24px rgb(34 42 53 / 0.06), 0 1px 1px rgb(0 0 0 / 0.05), 0 0 0 1px rgb(34 42 53 / 0.04), 0 0 4px rgb(34 42 53 / 0.08), 0 16px 68px rgb(47 48 55 / 0.08), inset 0 1px 0 rgb(255 255 255 / 0.6)` | `0 0 24px rgb(0 0 0 / 0.22), 0 1px 1px rgb(255 255 255 / 0.05), 0 0 0 1px rgb(255 255 255 / 0.08), 0 0 4px rgb(0 0 0 / 0.28), 0 16px 68px rgb(0 0 0 / 0.35), inset 0 1px 0 rgb(255 255 255 / 0.1)` |

## Compose And Customize

Complete presentational component example:

```tsx
export function StatusCard() {
  return <section className="rounded-lg border border-border bg-card p-4 text-card-foreground">
    <h2 className="font-medium">Ready</h2>
    <p className="text-sm text-muted-foreground">The operation was accepted.</p>
    <span className="text-success">Completed</span>
  </section>;
}
```

Override semantic variables deliberately in your own stylesheet after the
platform base. Prefer paired foreground/background values over fixed hex colors
per component; validate actual contrast in light/dark and disabled states.
Color is supplemental: use text/icons/state semantics for success/error.

Root base styles set html/body backgrounds/font, selection colors and focus
outline color. [Lanes](./lanes.md) explains public page/surface selectors;
[themes](./themes.md) controls the dark class. [Style builds](./style-build.md)
explains complete class-name discovery. No server permissions depend on tokens.
