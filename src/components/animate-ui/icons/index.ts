'use client';

/**
 * index.ts
 *
 * Public barrel for Zero's Animate UI icon pack. This file owns icon exports
 * only; it does not render application UI or choose icons for components.
 */

export {
  AnimateIcon,
  IconWrapper,
  getVariants,
  pathClassName,
  staticAnimations,
  useAnimateIconContext,
} from './icon';
export type {
  AnimateIconContextValue,
  AnimateIconProps,
  IconProps,
  IconWrapperProps,
} from './icon';

export {
  getZeroAnimatedIcon,
  hasZeroAnimatedIcon,
  resolveZeroAnimatedIcon,
  zeroAnimatedIconNames,
  zeroAnimatedIcons,
} from './registry';
export type {
  ZeroAnimatedIconComponent,
  ZeroAnimatedIconName,
} from './registry';
export { ZeroIcon } from './zero-icon';
export type { ZeroIconProps } from './zero-icon';

export { AlarmClock, AlarmClockIcon } from './alarm-clock';
export type { AlarmClockIconProps, AlarmClockProps } from './alarm-clock';
export { ArrowDown, ArrowDownIcon } from './arrow-down';
export type { ArrowDownIconProps, ArrowDownProps } from './arrow-down';
export { ArrowLeft, ArrowLeftIcon } from './arrow-left';
export type { ArrowLeftIconProps, ArrowLeftProps } from './arrow-left';
export { ArrowRight, ArrowRightIcon } from './arrow-right';
export type { ArrowRightIconProps, ArrowRightProps } from './arrow-right';
export { ArrowUp, ArrowUpIcon } from './arrow-up';
export type { ArrowUpIconProps, ArrowUpProps } from './arrow-up';
export { Bell, BellIcon } from './bell';
export type { BellIconProps, BellProps } from './bell';
export { ChartBar, ChartBarIcon } from './chart-bar';
export type { ChartBarIconProps, ChartBarProps } from './chart-bar';
export { ChartLine, ChartLineIcon } from './chart-line';
export type { ChartLineIconProps, ChartLineProps } from './chart-line';
export { Check, CheckIcon } from './check';
export type { CheckIconProps, CheckProps } from './check';
export { ChevronDown, ChevronDownIcon } from './chevron-down';
export type { ChevronDownIconProps, ChevronDownProps } from './chevron-down';
export { ChevronLeft, ChevronLeftIcon } from './chevron-left';
export type { ChevronLeftIconProps, ChevronLeftProps } from './chevron-left';
export { ChevronRight, ChevronRightIcon } from './chevron-right';
export type { ChevronRightIconProps, ChevronRightProps } from './chevron-right';
export { ChevronUp, ChevronUpIcon } from './chevron-up';
export type { ChevronUpIconProps, ChevronUpProps } from './chevron-up';
export { CircleCheck, CircleCheckIcon } from './circle-check';
export type { CircleCheckIconProps, CircleCheckProps } from './circle-check';
export { CircleX, CircleXIcon } from './circle-x';
export type { CircleXIconProps, CircleXProps } from './circle-x';
export { Clipboard, ClipboardIcon } from './clipboard';
export type { ClipboardIconProps, ClipboardProps } from './clipboard';
export { Clock, ClockIcon } from './clock';
export type { ClockIconProps, ClockProps } from './clock';
export { Compass, CompassIcon } from './compass';
export type { CompassIconProps, CompassProps } from './compass';
export { Copy, CopyIcon } from './copy';
export type { CopyIconProps, CopyProps } from './copy';
export { Download, DownloadIcon } from './download';
export type { DownloadIconProps, DownloadProps } from './download';
export { ExternalLink, ExternalLinkIcon } from './external-link';
export type { ExternalLinkIconProps, ExternalLinkProps } from './external-link';
export { Eye, EyeIcon } from './eye';
export type { EyeIconProps, EyeProps } from './eye';
export { EyeOff, EyeOffIcon } from './eye-off';
export type { EyeOffIconProps, EyeOffProps } from './eye-off';
export { Heart, HeartIcon } from './heart';
export type { HeartIconProps, HeartProps } from './heart';
export { Key, KeyIcon } from './key';
export type { KeyIconProps, KeyProps } from './key';
export { Layers, LayersIcon } from './layers';
export type { LayersIconProps, LayersProps } from './layers';
export { Lightbulb, LightbulbIcon } from './lightbulb';
export type { LightbulbIconProps, LightbulbProps } from './lightbulb';
export { Link, LinkIcon } from './link';
export type { LinkIconProps, LinkProps } from './link';
export { Link2, Link2Icon } from './link-2';
export type { Link2IconProps, Link2Props } from './link-2';
export { List, ListIcon } from './list';
export type { ListIconProps, ListProps } from './list';
export { Loader, LoaderIcon } from './loader';
export type { LoaderIconProps, LoaderProps } from './loader';
export { Lock, LockIcon } from './lock';
export type { LockIconProps, LockProps } from './lock';
export { LogIn, LogInIcon } from './log-in';
export type { LogInIconProps, LogInProps } from './log-in';
export { LogOut, LogOutIcon } from './log-out';
export type { LogOutIconProps, LogOutProps } from './log-out';
export { MapPin, MapPinIcon } from './map-pin';
export type { MapPinIconProps, MapPinProps } from './map-pin';
export { Maximize, MaximizeIcon } from './maximize';
export type { MaximizeIconProps, MaximizeProps } from './maximize';
export { Menu, MenuIcon } from './menu';
export type { MenuIconProps, MenuProps } from './menu';
export { MessageCircle, MessageCircleIcon } from './message-circle';
export type { MessageCircleIconProps, MessageCircleProps } from './message-circle';
export { MessageSquare, MessageSquareIcon } from './message-square';
export type { MessageSquareIconProps, MessageSquareProps } from './message-square';
export { Minimize, MinimizeIcon } from './minimize';
export type { MinimizeIconProps, MinimizeProps } from './minimize';
export { Moon, MoonIcon } from './moon';
export type { MoonIconProps, MoonProps } from './moon';
export { Paperclip, PaperclipIcon } from './paperclip';
export type { PaperclipIconProps, PaperclipProps } from './paperclip';
export { Pause, PauseIcon } from './pause';
export type { PauseIconProps, PauseProps } from './pause';
export { Pin, PinIcon } from './pin';
export type { PinIconProps, PinProps } from './pin';
export { Play, PlayIcon } from './play';
export type { PlayIconProps, PlayProps } from './play';
export { Plus, PlusIcon } from './plus';
export type { PlusIconProps, PlusProps } from './plus';
export { Radio, RadioIcon } from './radio';
export type { RadioIconProps, RadioProps } from './radio';
export { RotateCw, RotateCwIcon } from './rotate-cw';
export type { RotateCwIconProps, RotateCwProps } from './rotate-cw';
export { Scissors, ScissorsIcon } from './scissors';
export type { ScissorsIconProps, ScissorsProps } from './scissors';
export { Search, SearchIcon } from './search';
export type { SearchIconProps, SearchProps } from './search';
export { Send, SendIcon } from './send';
export type { SendIconProps, SendProps } from './send';
export { Settings, SettingsIcon } from './settings';
export type { SettingsIconProps, SettingsProps } from './settings';
export { Signal, SignalIcon } from './signal';
export type { SignalIconProps, SignalProps } from './signal';
export { Star, StarIcon } from './star';
export type { StarIconProps, StarProps } from './star';
export { Sun, SunIcon } from './sun';
export type { SunIconProps, SunProps } from './sun';
export { Terminal, TerminalIcon } from './terminal';
export type { TerminalIconProps, TerminalProps } from './terminal';
export { ThumbsUp, ThumbsUpIcon } from './thumbs-up';
export type { ThumbsUpIconProps, ThumbsUpProps } from './thumbs-up';
export { Timer, TimerIcon } from './timer';
export type { TimerIconProps, TimerProps } from './timer';
export { Trash, TrashIcon } from './trash';
export type { TrashIconProps, TrashProps } from './trash';
export { Upload, UploadIcon } from './upload';
export type { UploadIconProps, UploadProps } from './upload';
export { User, UserIcon } from './user';
export type { UserIconProps, UserProps } from './user';
export { Users, UsersIcon } from './users';
export type { UsersIconProps, UsersProps } from './users';
export { Volume2, Volume2Icon } from './volume-2';
export type { Volume2IconProps, Volume2Props } from './volume-2';
export { Wifi, WifiIcon } from './wifi';
export type { WifiIconProps, WifiProps } from './wifi';
export { X, XIcon } from './x';
export type { XIconProps, XProps } from './x';
