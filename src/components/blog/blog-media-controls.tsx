'use client';

import * as React from 'react';
import { Play, Pause, Volume2, VolumeX, Repeat, Maximize, Minimize, SkipBack, SkipForward } from 'lucide-react';
import { Button, type ButtonProps } from '../ui/button';
import { cn } from '../../lib/utils';
import { useBlogMedia, formatMediaTime, mediaClamp } from './blog-media-controller';
type MediaButtonProps = ButtonProps & { seconds?: number };
function ControlButton({ action, seconds = 10, onClick, children, disabled, ...props }: MediaButtonProps & { action: 'play' | 'mute' | 'loop' | 'back' | 'forward' | 'fullscreen' }) {
  const media = useBlogMedia(), muted = media.muted || media.volume === 0;
  const label = action === 'play' ? media.playing ? 'Pause' : 'Play' : action === 'mute' ? muted ? 'Unmute' : 'Mute' : action === 'loop' ? 'Loop playback' : action === 'fullscreen' ? media.fullscreen ? 'Exit fullscreen' : 'Fullscreen video' : action === 'back' ? `Back ${seconds} seconds` : `Forward ${seconds} seconds`;
  const icons = { play: media.playing ? <Pause /> : <Play />, mute: muted ? <VolumeX /> : <Volume2 />, loop: <Repeat />, back: <SkipBack />, forward: <SkipForward />, fullscreen: media.fullscreen ? <Minimize /> : <Maximize /> };
  return <Button type="button" variant="ghost" size="icon-sm" aria-label={label} aria-pressed={action === 'loop' ? media.loop : undefined} aria-busy={action === 'play' && media.pending || undefined}
    {...props} disabled={disabled || action === 'play' && media.pending || (action === 'back' || action === 'forward') && !media.duration}
    onClick={event => { onClick?.(event); if (event.defaultPrevented) return;
      if (action === 'play') media.togglePlay(); else if (action === 'mute') media.toggleMute(); else if (action === 'loop') media.toggleLoop();
      else if (action === 'fullscreen') void media.toggleFullscreen(); else media.seek(media.time + (action === 'back' ? -1 : 1) * mediaClamp(seconds, 0, 3600));
    }}>{children ?? icons[action]}</Button>;
}
export function AudioPlayerPlayButton(props: MediaButtonProps) { return <ControlButton {...props} action="play" />; }
export function AudioPlayerSkipBackwardButton(props: MediaButtonProps) { return <ControlButton {...props} action="back" />; }
export function AudioPlayerSkipForwardButton(props: MediaButtonProps) { return <ControlButton {...props} action="forward" />; }
export function AudioPlayerMuteButton(props: MediaButtonProps) { return <ControlButton {...props} action="mute" />; }
export function AudioPlayerLoopButton(props: MediaButtonProps) { return <ControlButton {...props} action="loop" />; }
export function VideoPlayerPlayButton(props: MediaButtonProps) { return <ControlButton {...props} action="play" />; }
export function VideoPlayerSeekBackwardButton(props: MediaButtonProps) { return <ControlButton {...props} action="back" />; }
export function VideoPlayerSeekForwardButton(props: MediaButtonProps) { return <ControlButton {...props} action="forward" />; }
export function VideoPlayerMuteButton(props: MediaButtonProps) { return <ControlButton {...props} action="mute" />; }
export function VideoPlayerFullscreenButton(props: MediaButtonProps) { return <ControlButton {...props} action="fullscreen" />; }
export function AudioPlayerVolumeSlider({ className, ...props }: Omit<React.ComponentProps<'input'>, 'type' | 'value' | 'defaultValue' | 'onChange' | 'min' | 'max'>) {
  const media = useBlogMedia();
  return <input {...props} type="range" className={cn('zero-blog-player-volume', className)} aria-label={props['aria-label'] ?? 'Volume'} min={0} max={1} step={props.step ?? .05} value={media.volume} onChange={event => media.setVolume(Number(event.currentTarget.value))} />;
}
export { AudioPlayerVolumeSlider as VideoPlayerVolumeRange };
export function AudioPlayerTimeDisplay({ format = 'both', ...props }: React.ComponentProps<'output'> & { format?: 'elapsed' | 'remaining' | 'both' }) {
  const media = useBlogMedia();
  return <output aria-label="Playback time" {...props}>{format === 'remaining' ? `−${formatMediaTime(media.duration - media.time)}` : format === 'elapsed' ? formatMediaTime(media.time) : `${formatMediaTime(media.time)} / ${formatMediaTime(media.duration)}`}</output>;
}
export { AudioPlayerTimeDisplay as VideoPlayerTimeDisplay };
export function AudioPlayerProgress({ className, ...props }: Omit<React.ComponentProps<'input'>, 'type' | 'value' | 'defaultValue' | 'onChange' | 'min' | 'max'>) {
  const media = useBlogMedia();
  return <input {...props} type="range" className={cn('zero-blog-player-progress', className)} aria-label={props['aria-label'] ?? 'Playback position'} aria-valuetext={formatMediaTime(media.time)} min={0} max={media.duration || 0} step={props.step ?? 'any'}
    value={mediaClamp(media.time, 0, media.duration)} disabled={props.disabled || !media.duration} onChange={event => media.seek(Number(event.currentTarget.value))}
    style={{ '--zero-blog-player-buffered': `${media.duration ? mediaClamp(media.buffered / media.duration * 100, 0, 100) : 0}%`, ...props.style } as React.CSSProperties} />;
}
export { AudioPlayerProgress as VideoPlayerTimeRange };
export function AudioPlayerWaveform({ peaks, className, interactive = true }: { peaks?: readonly number[]; className?: string; interactive?: boolean }) {
  const media = useBlogMedia(), values = (peaks ?? media.peaks).slice(0, 256);
  if (!values.length) return null;
  return <div className={cn('zero-blog-player-waveform', className)}><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">{values.map((peak, index) => {
    const height = mediaClamp(peak, 0, 1) * 100;
    return <rect key={index} x={index / values.length * 100} y={(100 - height) / 2} width={80 / values.length} height={height} data-played={index / values.length < media.time / (media.duration || 1) || undefined} />;
  })}</svg>{interactive && <AudioPlayerProgress aria-label="Waveform position" />}</div>;
}
export function VideoPlayerContent({ className, ...props }: React.ComponentProps<'div'>) { return <div {...props} className={cn('zero-blog-video-content', className)} />; }
export function VideoPlayerControlBar({ className, ...props }: React.ComponentProps<'div'>) { return <div {...props} className={cn('zero-blog-player-controls', className)} />; }
