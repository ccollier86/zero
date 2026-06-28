'use client';

/**
 * registry.ts
 *
 * Provides name-based access to Zero's Animate UI icon components for
 * config-driven UI. This file owns icon lookup metadata only; it does not
 * render icons or choose icon semantics for application features.
 */

import type { ComponentType } from 'react';
import type { IconProps } from './icon';
import { AlarmClock } from './alarm-clock';
import { ArrowDown } from './arrow-down';
import { ArrowLeft } from './arrow-left';
import { ArrowRight } from './arrow-right';
import { ArrowUp } from './arrow-up';
import { Bell } from './bell';
import { ChartBar } from './chart-bar';
import { ChartLine } from './chart-line';
import { Check } from './check';
import { ChevronDown } from './chevron-down';
import { ChevronLeft } from './chevron-left';
import { ChevronRight } from './chevron-right';
import { ChevronUp } from './chevron-up';
import { CircleCheck } from './circle-check';
import { CircleX } from './circle-x';
import { Clipboard } from './clipboard';
import { Clock } from './clock';
import { Compass } from './compass';
import { Copy } from './copy';
import { Download } from './download';
import { ExternalLink } from './external-link';
import { Eye } from './eye';
import { EyeOff } from './eye-off';
import { Heart } from './heart';
import { Key } from './key';
import { Layers } from './layers';
import { Lightbulb } from './lightbulb';
import { Link } from './link';
import { Link2 } from './link-2';
import { List } from './list';
import { Loader } from './loader';
import { Lock } from './lock';
import { LogIn } from './log-in';
import { LogOut } from './log-out';
import { MapPin } from './map-pin';
import { Maximize } from './maximize';
import { Menu } from './menu';
import { MessageCircle } from './message-circle';
import { MessageSquare } from './message-square';
import { Minimize } from './minimize';
import { Moon } from './moon';
import { Paperclip } from './paperclip';
import { Pause } from './pause';
import { Pin } from './pin';
import { Play } from './play';
import { Plus } from './plus';
import { Radio } from './radio';
import { RotateCw } from './rotate-cw';
import { Scissors } from './scissors';
import { Search } from './search';
import { Send } from './send';
import { Settings } from './settings';
import { Signal } from './signal';
import { Star } from './star';
import { Sun } from './sun';
import { Terminal } from './terminal';
import { ThumbsUp } from './thumbs-up';
import { Timer } from './timer';
import { Trash } from './trash';
import { Upload } from './upload';
import { User } from './user';
import { Users } from './users';
import { Volume2 } from './volume-2';
import { Wifi } from './wifi';
import { X } from './x';

export type ZeroAnimatedIconComponent = ComponentType<IconProps<any>>;

export const zeroAnimatedIcons = {
  'alarm-clock': AlarmClock,
  'arrow-down': ArrowDown,
  'arrow-left': ArrowLeft,
  'arrow-right': ArrowRight,
  'arrow-up': ArrowUp,
  bell: Bell,
  'chart-bar': ChartBar,
  'chart-line': ChartLine,
  check: Check,
  'chevron-down': ChevronDown,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  'chevron-up': ChevronUp,
  'circle-check': CircleCheck,
  'circle-x': CircleX,
  clipboard: Clipboard,
  clock: Clock,
  compass: Compass,
  copy: Copy,
  download: Download,
  'external-link': ExternalLink,
  eye: Eye,
  'eye-off': EyeOff,
  heart: Heart,
  key: Key,
  layers: Layers,
  lightbulb: Lightbulb,
  link: Link,
  'link-2': Link2,
  list: List,
  loader: Loader,
  lock: Lock,
  'log-in': LogIn,
  'log-out': LogOut,
  'map-pin': MapPin,
  maximize: Maximize,
  menu: Menu,
  'message-circle': MessageCircle,
  'message-square': MessageSquare,
  minimize: Minimize,
  moon: Moon,
  paperclip: Paperclip,
  pause: Pause,
  pin: Pin,
  play: Play,
  plus: Plus,
  radio: Radio,
  'rotate-cw': RotateCw,
  scissors: Scissors,
  search: Search,
  send: Send,
  settings: Settings,
  signal: Signal,
  star: Star,
  sun: Sun,
  terminal: Terminal,
  'thumbs-up': ThumbsUp,
  timer: Timer,
  trash: Trash,
  upload: Upload,
  user: User,
  users: Users,
  'volume-2': Volume2,
  wifi: Wifi,
  x: X,
} satisfies Record<string, ZeroAnimatedIconComponent>;

export type ZeroAnimatedIconName = keyof typeof zeroAnimatedIcons;

export const zeroAnimatedIconNames = Object.freeze(
  Object.keys(zeroAnimatedIcons),
) as readonly ZeroAnimatedIconName[];

/**
 * Return the animated icon component registered for a canonical icon name.
 *
 * Names are kebab-case and match the generated Animate UI icon filenames.
 */
export function getZeroAnimatedIcon(name: ZeroAnimatedIconName): ZeroAnimatedIconComponent {
  return zeroAnimatedIcons[name];
}

/**
 * Return true when `name` is available in Zero's default animated icon pack.
 *
 * Use this to validate config files or schema metadata before rendering a
 * dynamic icon by name.
 */
export function hasZeroAnimatedIcon(name: string): name is ZeroAnimatedIconName {
  return Object.prototype.hasOwnProperty.call(zeroAnimatedIcons, name);
}

/**
 * Resolve a user/config supplied icon name to a component, returning null for
 * missing names instead of throwing during render.
 */
export function resolveZeroAnimatedIcon(name: string): ZeroAnimatedIconComponent | null {
  return hasZeroAnimatedIcon(name) ? zeroAnimatedIcons[name] : null;
}
