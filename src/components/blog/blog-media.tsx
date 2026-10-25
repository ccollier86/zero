'use client';

/** Tokenized controls over actual media events. Waveforms require caller-supplied measurements, never random decoration. */
import * as React from 'react';
import { Play, Pause, Volume2, VolumeX, Repeat, Maximize } from 'lucide-react';
import { Button } from '../ui/button';
import { safeBlogHref } from './blog-utils';
import { cn } from '../../lib/utils';

export interface BlogMediaPlayerProps {
  src: string; title?: string; artist?: string; poster?: string; coverArt?: string; className?: string;
  peaks?: readonly number[]; loop?: boolean; onPlay?: () => void; onPause?: () => void; onError?: () => void;
}
const clock = (seconds: number) => `${Math.floor(Math.max(0, seconds) / 60)}:${String(Math.floor(Math.max(0, seconds)) % 60).padStart(2, '0')}`;
function MediaPlayer({ kind, src, title, artist, poster, coverArt, peaks, className, loop = false, onPlay, onPause, onError }: BlogMediaPlayerProps & { kind: 'audio' | 'video' }) {
  const ref = React.useRef<HTMLMediaElement | null>(null), [ready, setReady] = React.useState(false), [playing, setPlaying] = React.useState(false), [time, setTime] = React.useState(0), [duration, setDuration] = React.useState(0), [muted, setMuted] = React.useState(false), [volume, setVolume] = React.useState(1), [repeating, setRepeating] = React.useState(loop), [failed, setFailed] = React.useState(false);
  React.useEffect(() => { setReady(true); }, []);
  React.useEffect(() => { setTime(0); setDuration(0); setFailed(false); setPlaying(false); }, [src]);
  const safe = safeBlogHref(src); if (!safe) return null;
  const events = { onTimeUpdate: () => setTime(ref.current?.currentTime ?? 0), onLoadedMetadata: () => setDuration(Number.isFinite(ref.current?.duration) ? ref.current!.duration : 0),
    onPlay: () => { setPlaying(true); onPlay?.(); }, onPause: () => { setPlaying(false); onPause?.(); }, onEnded: () => setPlaying(false), onError: () => { setFailed(true); onError?.(); } };
  const toggle = async () => { if (!ref.current) return; if (playing) ref.current.pause(); else { try { await ref.current.play(); setFailed(false); } catch { setFailed(true); } } };
  return <figure className={cn('zero-blog-player', className)} data-kind={kind}>
    {kind === 'video' ? <video ref={element => { ref.current = element; }} src={safe} poster={safeBlogHref(poster)} preload="none" controls={!ready} playsInline loop={repeating} {...events} />
      : <audio ref={element => { ref.current = element; }} src={safe} preload="none" controls={!ready} loop={repeating} {...events} />}
    {(title || artist || coverArt) && <figcaption className="zero-blog-player-caption">{safeBlogHref(coverArt) && <img src={safeBlogHref(coverArt)} alt="" />}<span>{title && <strong>{title}</strong>}{artist && <span>{artist}</span>}</span></figcaption>}
    {ready && <div className="zero-blog-player-controls">
      <Button type="button" variant="ghost" size="icon-sm" aria-label={playing ? 'Pause' : 'Play'} onClick={() => { void toggle(); }}>{playing ? <Pause /> : <Play />}</Button>
      <div className="zero-blog-player-seek">{!!peaks?.length && <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">{peaks.slice(0, 256).map((peak, index, all) => {
        const height = Math.max(0, Math.min(1, Number.isFinite(peak) ? peak : 0)) * 100;
        return <rect key={index} x={index / all.length * 100} y={(100 - height) / 2} width={80 / all.length} height={height} data-played={index / all.length <= time / (duration || 1) || undefined} />;
      })}</svg>}
        <input type="range" aria-label="Playback position" min={0} max={duration || 0} step="any" value={Math.min(time, duration)} disabled={!duration} onChange={event => { if (ref.current) { ref.current.currentTime = Number(event.currentTarget.value); setTime(ref.current.currentTime); } }} />
      </div>
      <output aria-label="Playback time">{clock(time)} / {clock(duration)}</output>
      <Button type="button" variant="ghost" size="icon-sm" aria-label={muted ? 'Unmute' : 'Mute'} onClick={() => { if (ref.current) { ref.current.muted = !muted; setMuted(!muted); } }}>{muted ? <VolumeX /> : <Volume2 />}</Button>
      <input type="range" className="zero-blog-player-volume" aria-label="Volume" min={0} max={1} step={.05} value={volume} onChange={event => { const value = Number(event.currentTarget.value); if (ref.current) { ref.current.volume = value; setVolume(value); } }} />
      <Button type="button" variant="ghost" size="icon-sm" aria-label="Loop playback" aria-pressed={repeating} onClick={() => setRepeating(value => !value)}><Repeat /></Button>
      {kind === 'video' && <Button type="button" variant="ghost" size="icon-sm" aria-label="Fullscreen video" onClick={() => { if (ref.current instanceof HTMLVideoElement) void ref.current.requestFullscreen?.().catch(() => setFailed(true)); }}><Maximize /></Button>}
    </div>}
    {failed && <p role="alert">This media could not be played.</p>}
  </figure>;
}
export function AudioPlayer(props: BlogMediaPlayerProps) { return <MediaPlayer {...props} kind="audio" />; }
export function VideoPlayer(props: BlogMediaPlayerProps) { return <MediaPlayer {...props} kind="video" />; }
