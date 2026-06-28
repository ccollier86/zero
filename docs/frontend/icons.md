# Frontend Icons

Zero's default icon pack is the Animate UI animated Lucide set. Use these icons
for platform UI and app UI by default. Use `lucide-react` directly only when
Zero does not ship an animated icon for the shape you need.

Import direct icon components from `@platform/frontend/icons`:

```tsx
import { AnimateIcon, Check, Trash } from '@platform/frontend/icons';

export function DeleteButton() {
  return (
    <button type="button">
      <AnimateIcon animateOnHover>
        <Trash size={18} />
      </AnimateIcon>
      Delete
    </button>
  );
}

export function SavedState() {
  return <Check animate className="text-emerald-600" />;
}
```

Use `ZeroIcon` when the icon is data-driven from config, schema metadata, or a
generated UI description:

```tsx
import { ZeroIcon, hasZeroAnimatedIcon } from '@platform/frontend/icons';

function FieldIcon({ icon }: { icon: string }) {
  if (!hasZeroAnimatedIcon(icon)) return null;
  return <ZeroIcon name={icon} size={16} animateOnHover />;
}
```

The registry exports `zeroAnimatedIconNames`, `zeroAnimatedIcons`,
`getZeroAnimatedIcon`, `resolveZeroAnimatedIcon`, and `hasZeroAnimatedIcon`.
Canonical registry names are kebab-case and match the generated Animate UI
filenames, for example `arrow-right`, `circle-check`, `log-in`, and `trash`.

## Available Icons

`AlarmClock`, `ArrowDown`, `ArrowLeft`, `ArrowRight`, `ArrowUp`, `Bell`,
`ChartBar`, `ChartLine`, `Check`, `ChevronDown`, `ChevronLeft`,
`ChevronRight`, `ChevronUp`, `CircleCheck`, `CircleX`, `Clipboard`, `Clock`,
`Compass`, `Copy`, `Download`, `ExternalLink`, `Eye`, `EyeOff`, `Heart`,
`Key`, `Layers`, `Lightbulb`, `Link`, `Link2`, `List`, `Loader`, `Lock`,
`LogIn`, `LogOut`, `MapPin`, `Maximize`, `Menu`, `MessageCircle`,
`MessageSquare`, `Minimize`, `Moon`, `Paperclip`, `Pause`, `Pin`, `Play`,
`Plus`, `Radio`, `RotateCw`, `Scissors`, `Search`, `Send`, `Settings`,
`Signal`, `Star`, `Sun`, `Terminal`, `ThumbsUp`, `Timer`, `Trash`, `Upload`,
`User`, `Users`, `Volume2`, `Wifi`, and `X`.

## Adding More Icons

Animate UI icons are generated from Lucide names. Add the icon wrapper and icon
files with the upstream Animate UI/shadcn command, then export the new icon from
`src/components/animate-ui/icons/index.ts` and add it to
`src/components/animate-ui/icons/registry.ts`.
