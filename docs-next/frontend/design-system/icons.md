---
id: zero.design-system.icons
type: reference
audience: [developer, agent, operator]
owner: design-system
status: draft
visibility: internal
system: design-system
feature: icons
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

# Named Animated Icons

[Design-system index](./index.md) · [Documentation index](../../index.md)

Import named icons from `@zero/framework/icons`. Each named alias and its
Icon-suffixed alias points to the same icon implementation; corresponding
FooProps/FooIconProps types are public. Root/react exposes generic AnimateIcon/
ZeroIcon/registry helpers, **not** the whole named pack.

## Complete Pack

| Canonical registry name | Named import | Equivalent alias |
| --- | --- | --- |
| `alarm-clock` | `AlarmClock` | `AlarmClockIcon` |
| `arrow-down` | `ArrowDown` | `ArrowDownIcon` |
| `arrow-left` | `ArrowLeft` | `ArrowLeftIcon` |
| `arrow-right` | `ArrowRight` | `ArrowRightIcon` |
| `arrow-up` | `ArrowUp` | `ArrowUpIcon` |
| `bell` | `Bell` | `BellIcon` |
| `chart-bar` | `ChartBar` | `ChartBarIcon` |
| `chart-line` | `ChartLine` | `ChartLineIcon` |
| `check` | `Check` | `CheckIcon` |
| `chevron-down` | `ChevronDown` | `ChevronDownIcon` |
| `chevron-left` | `ChevronLeft` | `ChevronLeftIcon` |
| `chevron-right` | `ChevronRight` | `ChevronRightIcon` |
| `chevron-up` | `ChevronUp` | `ChevronUpIcon` |
| `circle-check` | `CircleCheck` | `CircleCheckIcon` |
| `circle-x` | `CircleX` | `CircleXIcon` |
| `clipboard` | `Clipboard` | `ClipboardIcon` |
| `clock` | `Clock` | `ClockIcon` |
| `compass` | `Compass` | `CompassIcon` |
| `copy` | `Copy` | `CopyIcon` |
| `download` | `Download` | `DownloadIcon` |
| `external-link` | `ExternalLink` | `ExternalLinkIcon` |
| `eye` | `Eye` | `EyeIcon` |
| `eye-off` | `EyeOff` | `EyeOffIcon` |
| `heart` | `Heart` | `HeartIcon` |
| `key` | `Key` | `KeyIcon` |
| `layers` | `Layers` | `LayersIcon` |
| `lightbulb` | `Lightbulb` | `LightbulbIcon` |
| `link` | `Link` | `LinkIcon` |
| `link-2` | `Link2` | `Link2Icon` |
| `list` | `List` | `ListIcon` |
| `loader` | `Loader` | `LoaderIcon` |
| `lock` | `Lock` | `LockIcon` |
| `log-in` | `LogIn` | `LogInIcon` |
| `log-out` | `LogOut` | `LogOutIcon` |
| `map-pin` | `MapPin` | `MapPinIcon` |
| `maximize` | `Maximize` | `MaximizeIcon` |
| `menu` | `Menu` | `MenuIcon` |
| `message-circle` | `MessageCircle` | `MessageCircleIcon` |
| `message-square` | `MessageSquare` | `MessageSquareIcon` |
| `minimize` | `Minimize` | `MinimizeIcon` |
| `moon` | `Moon` | `MoonIcon` |
| `paperclip` | `Paperclip` | `PaperclipIcon` |
| `pause` | `Pause` | `PauseIcon` |
| `pin` | `Pin` | `PinIcon` |
| `play` | `Play` | `PlayIcon` |
| `plus` | `Plus` | `PlusIcon` |
| `radio` | `Radio` | `RadioIcon` |
| `rotate-cw` | `RotateCw` | `RotateCwIcon` |
| `scissors` | `Scissors` | `ScissorsIcon` |
| `search` | `Search` | `SearchIcon` |
| `send` | `Send` | `SendIcon` |
| `settings` | `Settings` | `SettingsIcon` |
| `signal` | `Signal` | `SignalIcon` |
| `star` | `Star` | `StarIcon` |
| `sun` | `Sun` | `SunIcon` |
| `terminal` | `Terminal` | `TerminalIcon` |
| `thumbs-up` | `ThumbsUp` | `ThumbsUpIcon` |
| `timer` | `Timer` | `TimerIcon` |
| `trash` | `Trash` | `TrashIcon` |
| `upload` | `Upload` | `UploadIcon` |
| `user` | `User` | `UserIcon` |
| `users` | `Users` | `UsersIcon` |
| `volume-2` | `Volume2` | `Volume2Icon` |
| `wifi` | `Wifi` | `WifiIcon` |
| `x` | `X` | `XIcon` |

Complete action example:

```tsx
import { Button } from "@zero/framework/react";
import { Plus } from "@zero/framework/icons";

export function CreateAction({ create }: { create: () => void }) {
  return <Button onClick={create}><Plus aria-hidden="true" /> Create</Button>;
}
```

Button normally supplies hover/tap animation context. Icons use currentColor;
use token-based text classes and intentional size. Standalone IconWrapper
defaults to28; button SVG sizing may override through utility classes.

Icons are presentational. Give icon-only buttons an accessible name on the
button; mark decorative icons aria-hidden. Do not imply a spinner/lock grants
authorization or an operation completed. [Animation](./icon-animation.md)
documents per-icon/default/path variants; [registry](./icon-registry.md)
documents config-driven rendering and admission.
