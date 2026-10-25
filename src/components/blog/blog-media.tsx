'use client';

import * as React from 'react';
import { safeBlogHref } from './blog-utils';
import { cn } from '../../lib/utils';
import { BlogMediaContext, useMediaController, useBlogMedia, type BlogMediaOptions } from './blog-media-controller';
import { AudioPlayerPlayButton, AudioPlayerProgress, AudioPlayerTimeDisplay, AudioPlayerMuteButton, AudioPlayerVolumeSlider, AudioPlayerLoopButton,
  AudioPlayerSkipBackwardButton, AudioPlayerSkipForwardButton, AudioPlayerWaveform, VideoPlayerFullscreenButton, VideoPlayerContent, VideoPlayerControlBar } from './blog-media-controls';

export interface BlogMediaPlayerProps extends BlogMediaOptions {
  src: string; title?: string; artist?: string; poster?: string; coverArt?: string; className?: string; style?: React.CSSProperties; children?: React.ReactNode;
  peaks?: readonly number[]; autoPlay?: boolean; preload?: 'none' | 'metadata' | 'auto'; variant?: 'default' | 'minimal' | 'synthwave';
  aspectRatio?: 'video' | 'square' | '4/3' | '21/9'; rounded?: 'none' | 'sm' | 'md' | 'lg' | 'xl';
  controlsLayout?: 'overlay' | 'below'; controlsAutoHideMs?: number; skipSeconds?: number;
  showSkip?: boolean; showVolume?: boolean; showLoop?: boolean; showWaveform?: boolean; showFullscreen?: boolean;
  tracks?: readonly { src: string; kind?: 'subtitles' | 'captions' | 'descriptions'; srcLang: string; label: string; default?: boolean }[];
}
export type AudioPlayerProps = BlogMediaPlayerProps;
export type VideoPlayerProps = BlogMediaPlayerProps;
function Defaults({ kind, variant, skipSeconds, showSkip = true, showVolume = true, showLoop = true, showWaveform = true, showFullscreen = true }: BlogMediaPlayerProps & { kind: 'audio' | 'video' }) {
  const media = useBlogMedia(), small = variant === 'minimal';
  return <>
    {kind === 'audio' && showWaveform && !!media.peaks.length && !small && <AudioPlayerWaveform />}
    <VideoPlayerControlBar><AudioPlayerPlayButton />{showSkip && !small && <><AudioPlayerSkipBackwardButton seconds={skipSeconds} /><AudioPlayerSkipForwardButton seconds={skipSeconds} /></>}
      <AudioPlayerProgress /><AudioPlayerTimeDisplay /><AudioPlayerMuteButton />{showVolume && !small && <AudioPlayerVolumeSlider />}
      {showLoop && !small && <AudioPlayerLoopButton />}{kind === 'video' && showFullscreen && <VideoPlayerFullscreenButton />}
    </VideoPlayerControlBar>
  </>;
}
function MediaPlayer({ kind, ...props }: BlogMediaPlayerProps & { kind: 'audio' | 'video' }) {
  const media = useMediaController(kind, props, props.peaks), [visible, setVisible] = React.useState(true), [focused, setFocused] = React.useState(false);
  const source = safeBlogHref(props.src), overlay = kind === 'video' && (props.controlsLayout ?? 'overlay') === 'overlay';
  const [activity, setActivity] = React.useState(0);
  const lastPointer = React.useRef(0);
  React.useEffect(() => {
    setVisible(true); if (!overlay || !media.playing || focused || props.controlsAutoHideMs === 0) return;
    const delay = Number.isFinite(props.controlsAutoHideMs) ? props.controlsAutoHideMs! : 2500;
    const timer = setTimeout(() => setVisible(false), Math.max(500, Math.min(30000, delay))); return () => clearTimeout(timer);
  }, [overlay, media.playing, activity, focused, props.controlsAutoHideMs]);
  if (!source) return null;
  const controls = props.children ?? <Defaults {...props} kind={kind} />;
  return <BlogMediaContext.Provider value={media}><figure ref={media.attachFrame} className={cn('zero-blog-player', props.className)} data-kind={kind} data-variant={props.variant ?? 'default'}
    data-layout={overlay ? 'overlay' : 'below'} data-rounded={props.rounded ?? 'xl'} data-aspect={props.aspectRatio ?? 'video'} style={props.style}
    role="group" aria-label={props.title ?? `${kind === 'video' ? 'Video' : 'Audio'} player`} tabIndex={kind === 'video' ? 0 : undefined}
    onPointerMove={() => { if (!visible) setVisible(true); const now = Date.now(); if (media.playing && now - lastPointer.current >= 250) { lastPointer.current = now; setActivity(value => value + 1); } }}
    onFocusCapture={() => { setFocused(true); setVisible(true); }} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}
    onKeyDown={event => { if (event.target !== event.currentTarget) return; if (event.key === ' ' || event.key === 'k') { event.preventDefault(); media.togglePlay(); } else if (event.key === 'ArrowRight') { event.preventDefault(); media.seek(media.time + (props.skipSeconds ?? 10)); } else if (event.key === 'ArrowLeft') { event.preventDefault(); media.seek(media.time - (props.skipSeconds ?? 10)); } }}>
    {kind === 'video' ? <video key={source} ref={media.attach} src={source} poster={safeBlogHref(props.poster)} autoPlay={props.autoPlay ?? false} preload={props.preload ?? 'none'} controls={!media.ready} playsInline muted={props.muted ?? false} loop={media.loop}>
      {props.tracks?.flatMap((track, index) => safeBlogHref(track.src) ? [<track key={index} {...track} src={safeBlogHref(track.src)} />] : [])}
    </video> : <audio key={source} ref={media.attach} src={source} autoPlay={props.autoPlay ?? false} preload={props.preload ?? 'none'} controls={!media.ready} muted={props.muted ?? false} loop={media.loop} />}
    {(props.title || props.artist || safeBlogHref(props.coverArt)) && <figcaption className="zero-blog-player-caption">{safeBlogHref(props.coverArt) && <img src={safeBlogHref(props.coverArt)} alt="" />}<span>{props.title && <strong>{props.title}</strong>}{props.artist && <span>{props.artist}</span>}</span></figcaption>}
    {media.ready && <div className="zero-blog-player-custom" data-visible={visible || !overlay || undefined} inert={overlay && !visible || undefined}>{overlay && props.children === undefined ? <VideoPlayerContent>{controls}</VideoPlayerContent> : controls}</div>}
    {media.failed && <p role="alert">This media could not be played.</p>}
  </figure></BlogMediaContext.Provider>;
}
export function AudioPlayer(props: BlogMediaPlayerProps) { return <MediaPlayer {...props} kind="audio" />; }
export function VideoPlayer(props: BlogMediaPlayerProps) { return <MediaPlayer {...props} kind="video" />; }
export function AudioPlayerMinimal(props: Omit<BlogMediaPlayerProps, 'variant'>) { return <AudioPlayer {...props} variant="minimal" />; }
export function AudioPlayerSynthwave(props: Omit<BlogMediaPlayerProps, 'variant'>) { return <AudioPlayer {...props} variant="synthwave" />; }
export { VideoPlayer as VideoPlayerDefault };
export function useAudioPlayer() { return useBlogMedia('audio'); }
export function useVideoPlayer() { return useBlogMedia('video'); }
export * from './blog-media-controls';
export { formatMediaTime } from './blog-media-controller';
