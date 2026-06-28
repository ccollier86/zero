/**
 * index.ts
 *
 * Barrel for generic React hooks that are safe for app frontend bundles. This
 * file exports UI primitives only; platform SDK and transport hooks live under
 * `src/frontend/client`.
 */

export { useAsyncAction } from './use-async-action';
export type { UseAsyncActionOptions, UseAsyncActionReturn } from './use-async-action';
export { useAutoHeight } from './use-auto-height';
export type { AutoHeightOptions } from './use-auto-height';
export { ConfirmProvider, useConfirm } from './use-confirm';
export type { ConfirmOptions } from './use-confirm';
export { useControlledState } from './use-controlled-state';
export type { CommonControlledStateProps } from './use-controlled-state';
export { useDataState } from './use-data-state';
export type { DataStateValue } from './use-data-state';
export { useDebouncedCallback } from './use-debounced-callback';
export type {
  UseDebouncedCallbackOptions,
  UseDebouncedCallbackReturn,
} from './use-debounced-callback';
export { useDebouncedValue } from './use-debounced-value';
export { useDisclosure } from './use-disclosure';
export type { UseDisclosureOptions, UseDisclosureReturn } from './use-disclosure';
export { useClickAway } from './use-click-away';
export type { ClickAwayEvent, UseClickAwayOptions } from './use-click-away';
export { useCopyToClipboard } from './use-copy-to-clipboard';
export type {
  UseCopyToClipboardOptions,
  UseCopyToClipboardReturn,
} from './use-copy-to-clipboard';
export { useHotkey } from './use-hotkey';
export type { HotkeyHandler, HotkeyOptions } from './use-hotkey';
export { useIdle } from './use-idle';
export type { UseIdleOptions } from './use-idle';
export { useInterval } from './use-interval';
export type { UseIntervalOptions } from './use-interval';
export { useIsInView } from './use-is-in-view';
export type { UseIsInViewOptions } from './use-is-in-view';
export { useMediaQuery } from './use-media-query';
export type { UseMediaQueryOptions } from './use-media-query';
export { useIsMobile } from './use-mobile';
export { useMounted } from './use-mounted';
export { useMotionValueState } from './use-motion-value-state';
export { getOS, useOs } from './use-os';
export type { OperatingSystem, OSDetectionInput, UseOsOptions, UseOsReturnValue } from './use-os';
export { usePrevious } from './use-previous';
export { useStableCallback } from './use-stable-callback';
export { useTextSelection } from './use-text-selection';
export { useThrottledCallback } from './use-throttled-callback';
export type {
  UseThrottledCallbackOptions,
  UseThrottledCallbackReturn,
} from './use-throttled-callback';
export { useThrottledValue } from './use-throttled-value';
export type { UseThrottledValueOptions } from './use-throttled-value';
export { useTimeout } from './use-timeout';
