/** Native/shared control, card, avatar and settings composition. Curated client-safe re-exports only; implementation/context ownership stays with the existing modules. */

// ─── UI Components ──────────────────────────────────────────────────────
export { Text, Heading } from '../../../components/typography';
export type { TextProps, TextElement, HeadingProps, HeadingElement } from '../../../components/typography';
export type { TypographyRole, TypographyRecipe } from '../../../design-system/theme-typography';
export { FloatingButtonGroup } from '../../../components/controls/floating-button-group';
export type { FloatingButtonGroupProps, FloatingButtonGroupAction, FloatingButtonGroupSeparator, FloatingButtonGroupItem,
  FloatingButtonGroupVariant, FloatingButtonGroupSize, FloatingButtonGroupOrientation } from '../../../components/controls/floating-button-group';
export { Button, buttonVariants } from '../../../components/ui/button';
export {
  ButtonGroup, ButtonGroupText, ButtonGroupSeparator, buttonGroupVariants,
  ButtonGroupToggle, ButtonGroupToggleItem,
} from '../../../components/button-group';
export type {
  ButtonGroupProps, ButtonGroupTextProps, ButtonGroupSeparatorProps, ButtonGroupLayoutProps,
  ButtonGroupToggleProps, ButtonGroupToggleItemProps, ButtonGroupToggleSize, ButtonGroupToggleVariant,
} from '../../../components/button-group';
export { Input } from '../../../components/ui/input';
export { Label } from '../../../components/ui/label';
export { Textarea } from '../../../components/ui/textarea';
export { Badge, badgeVariants } from '../../../components/ui/badge';
export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter,
  CardAction, CardMedia, CardByline, CardMeta, CardStatus, CardSection } from '../../../components/ui/card';
export type { CardProps, CardDensity, CardBylineProps, CardStatusProps } from '../../../components/ui/card';
export { ContentCard } from '../../../components/ui/content-card';
export type { ContentCardProps, ContentCardDetailsOptions } from '../../../components/ui/content-card';
export {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel,
  SelectSeparator, SelectTrigger, SelectValue,
} from '../../../components/ui/select';
export type { SelectContentProps, SelectItemProps } from '../../../components/ui/select';
export {
  Table, TableBody, TableCaption, TableCell, TableFooter,
  TableHead, TableHeader, TableRow,
} from '../../../components/ui/table';
export { ScrollArea, ScrollBar } from '../../../components/ui/scroll-area';
export type { ScrollAreaProps } from '../../../components/ui/scroll-area';
export { Separator } from '../../../components/ui/separator';
export { Skeleton } from '../../../components/ui/skeleton';
export { Avatar, AvatarImage, AvatarFallback } from '../../../components/ui/avatar';
export { AvatarGroup, AvatarPresenceIndicator } from '../../../components/avatar-group';
export { AvatarEditor, AvatarCropDialog } from '../../../components/avatar-editor';
export type { AvatarEditorProps, AvatarCropDialogProps } from '../../../components/avatar-editor';
export type {
  AvatarGroupProps, AvatarGroupMember, AvatarGroupAddAction, AvatarGroupShape,
  AvatarGroupSize, AvatarPresence, AvatarPresenceTone, AvatarPresenceIndicatorProps,
} from '../../../components/avatar-group';
export { SettingsMatrix } from '../../../components/settings-matrix';
export type {
  SettingsMatrixCapability, SettingsMatrixColumn, SettingsMatrixRow,
  SettingsMatrixValue, SettingsMatrixChange, SettingsMatrixChangeContext,
  SettingsMatrixProps,
} from '../../../components/settings-matrix';
export { IntegrationSettingsList } from '../../../components/integration-settings-list';
export type {
  IntegrationSettingsListProps, IntegrationSettingsGroup, IntegrationSettingsItem,
  IntegrationSettingsStatus, IntegrationSettingsStatusTone, IntegrationSettingsAction,
  IntegrationSettingsActionContext, IntegrationSettingsPrimaryAction,
  IntegrationSettingsConfirmation, IntegrationSettingsErrorContext,
} from '../../../components/integration-settings-list';
export {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
  BreadcrumbEllipsis,
} from '../../../components/ui/breadcrumb';
export {
  FormField, FormLabel, FormControl, FormDescription, FormMessage,
} from '../../../components/ui/form-field';
export {
  Pagination, PaginationContent, PaginationEllipsis, PaginationItem,
  PaginationLink, PaginationNext, PaginationPrevious,
} from '../../../components/ui/pagination';
