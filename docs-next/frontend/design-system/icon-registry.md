---
id: zero.design-system.icon-registry
type: reference
audience: [developer, agent, operator]
owner: design-system
status: draft
visibility: internal
system: design-system
feature: icon-registry
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

# Typed And Dynamic Icon Lookup

[Design-system index](./index.md) · [Documentation index](../../index.md)

The public registry is available from root/react and /icons:

| API | Result / input admission |
| --- | --- |
| zeroAnimatedIcons | canonical kebab-name→component map |
| zeroAnimatedIconNames | frozen readonly array of canonical names |
| getZeroAnimatedIcon(name: ZeroAnimatedIconName) | directly returns indexed component |
| hasZeroAnimatedIcon(name: string) | own-property check; narrows to valid name |
| resolveZeroAnimatedIcon(name: string) | component or null when not present |
| ZeroIcon({name,...props}) | renders valid typed name; no missing-name fallback |
| ZeroAnimatedIconName / ZeroAnimatedIconComponent / ZeroIconProps | public type contracts |

getZeroAnimatedIcon is typed admission, not runtime fallback: bypassing types
with an unknown name can yield undefined. Do not pass unvalidated API strings
to ZeroIcon. Resolve/narrow before rendering.

Complete component example:

```tsx
import { hasZeroAnimatedIcon, ZeroIcon } from "@zero/framework/react";

export function ConfigIcon({ name }: { name: string }) {
  if (!hasZeroAnimatedIcon(name)) return null;
  return <ZeroIcon name={name} size={20} aria-hidden="true" />;
}
```

Use named imports for compile-time choices and the registry for schema/config
data. Missing optional icon data may legitimately render nothing; app controls
must retain text/accessible meaning. Names and lookup do not authorize any
action.

[Named pack](./icons.md) is the exact mapping,
[animation](./icon-animation.md) owns props and
[configuration](./configuration.md) records defaults.
