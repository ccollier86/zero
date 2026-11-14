/** Use Zero's actual icons first. Explicit fallbacks are only glyphs absent from its current registry. */
import type { ComponentProps } from 'react';
import { ArrowLeft, Bell, Check, ChevronDown, ChevronLeft, ChevronRight, CircleCheck, Clock, Copy, Eye, Lock, MapPin, Plus, RotateCw, Search, Settings, Trash, User, Users, X } from '@zero/framework/icons';
type Props = Omit<ComponentProps<typeof Clock>, 'size' | 'stroke'> & { size?: number | string; stroke?: number | string };
function glyph(Icon: typeof Clock) {
  return function CalendarGlyph({ size = 'var(--calendar-size-16)', style, stroke, ...props }: Props) { return <Icon {...props} {...(typeof stroke === 'string' ? { stroke } : {})} style={{ width: size, height: size, flexShrink: 0, ...(typeof stroke === 'number' ? { strokeWidth: stroke } : {}), ...style }} />; };
}
export const IconArrowLeft = glyph(ArrowLeft), IconBell = glyph(Bell), IconCheck = glyph(Check), IconChevronDown = glyph(ChevronDown), IconChevronLeft = glyph(ChevronLeft), IconChevronRight = glyph(ChevronRight), IconCircleCheck = glyph(CircleCheck), IconClock = glyph(Clock), IconCopy = glyph(Copy), IconEye = glyph(Eye), IconLock = glyph(Lock), IconMapPin = glyph(MapPin), IconPlus = glyph(Plus), IconRotateClockwise = glyph(RotateCw), IconSearch = glyph(Search), IconSettings = glyph(Settings), IconTrash = glyph(Trash), IconUser = glyph(User), IconUsers = glyph(Users), IconX = glyph(X);
// No exact Zero registry glyph exists for these. Do not substitute another library for a supported Zero icon.
export { IconAlertTriangle, IconArrowsMove, IconCalendarPlus, IconCalendarRepeat, IconClipboardCheck, IconDots, IconEdit, IconMail, IconNotes, IconPhone, IconRepeat, IconStethoscope, IconVideo, IconWand } from './calendar-icon-fallbacks';
