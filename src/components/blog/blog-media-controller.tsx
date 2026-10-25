'use client';

/** One native element and one local controller per player. No shared singleton playback state. */
import * as React from 'react';
export interface BlogMediaState { playing: boolean; muted: boolean; loop: boolean; time: number; duration: number; volume: number; buffered: number; pending: boolean; failed: boolean; fullscreen: boolean }
export interface BlogMediaOptions { muted?: boolean; loop?: boolean; defaultVolume?: number; onPlay?: () => void; onPause?: () => void; onError?: () => void }
export interface BlogMediaController extends BlogMediaState {
  kind: 'audio' | 'video'; ready: boolean; peaks: readonly number[];
  attach: (element: HTMLMediaElement | null) => void; attachFrame: (element: HTMLElement | null) => void;
  play: () => Promise<boolean>; pause: () => void; togglePlay: () => void; toggleMute: () => void; toggleLoop: () => void;
  seek: (seconds: number) => void; setVolume: (volume: number) => void; toggleFullscreen: () => Promise<boolean>;
}
export const BlogMediaContext = React.createContext<BlogMediaController | null>(null);
export function useBlogMedia(kind?: 'audio' | 'video') {
  const value = React.useContext(BlogMediaContext);
  if (!value || kind && value.kind !== kind) throw new Error(`This control must be inside its ${kind ?? 'media'} player.`);
  return value;
}
export const mediaClamp = (value: number, min: number, max: number) => Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : min;
export function formatMediaTime(seconds: number): string {
  const time = Math.floor(Number.isFinite(seconds) ? Math.max(0, seconds) : 0), minutes = Math.floor(time / 60), remainder = String(time % 60).padStart(2, '0');
  return minutes >= 60 ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${remainder}` : `${minutes}:${remainder}`;
}
const notify = (callback?: () => void) => { try { void Promise.resolve(callback?.()).catch(() => {}); } catch { /* Observer only. */ } };
export function useMediaController(kind: 'audio' | 'video', options: BlogMediaOptions, peaks: readonly number[] = []): BlogMediaController {
  const [element, attach] = React.useState<HTMLMediaElement | null>(null), [frame, attachFrame] = React.useState<HTMLElement | null>(null), [ready, setReady] = React.useState(false);
  const [state, setState] = React.useState<BlogMediaState>({ playing: false, muted: options.muted ?? false, loop: options.loop ?? false,
    time: 0, duration: 0, volume: mediaClamp(options.defaultVolume ?? 1, 0, 1), buffered: 0, pending: false, failed: false, fullscreen: false });
  const callbacks = React.useRef(options); callbacks.current = options;
  const serial = React.useRef(0), desiredPlay = React.useRef(false), lastVolume = React.useRef(1), liveElement = React.useRef(element); liveElement.current = element;
  const read = React.useCallback(() => {
    if (!element) return;
    let buffered = 0; try { if (element.buffered.length) buffered = element.buffered.end(element.buffered.length - 1); } catch { /* Replaced TimeRanges. */ }
    setState(previous => ({ ...previous, playing: !element.paused && !element.ended, muted: element.muted, loop: element.loop,
      time: Number.isFinite(element.currentTime) ? element.currentTime : 0, duration: Number.isFinite(element.duration) ? element.duration : 0,
      volume: element.volume, buffered: Number.isFinite(buffered) ? buffered : 0 }));
  }, [element]);
  React.useEffect(() => { setReady(true); }, []);
  React.useEffect(() => {
    if (!element) return;
    element.volume = mediaClamp(callbacks.current.defaultVolume ?? 1, 0, 1); lastVolume.current = element.volume || 1;
    desiredPlay.current = false; ++serial.current;
    setState(previous => ({ ...previous, pending: false, failed: false })); read();
    const play = () => { read(); notify(callbacks.current.onPlay); }, pause = () => { read(); notify(callbacks.current.onPause); };
    const error = () => { setState(previous => ({ ...previous, failed: true, pending: false })); notify(callbacks.current.onError); };
    const events = ['timeupdate', 'loadedmetadata', 'durationchange', 'progress', 'volumechange', 'ended', 'emptied'] as const;
    events.forEach(event => element.addEventListener(event, read)); element.addEventListener('play', play); element.addEventListener('pause', pause); element.addEventListener('error', error);
    return () => { ++serial.current; desiredPlay.current = false; events.forEach(event => element.removeEventListener(event, read)); element.removeEventListener('play', play); element.removeEventListener('pause', pause); element.removeEventListener('error', error); element.pause(); };
  }, [element, read]);
  React.useEffect(() => { if (element) { element.muted = options.muted ?? false; read(); } }, [element, options.muted, read]);
  React.useEffect(() => { if (element) { element.loop = options.loop ?? false; read(); } }, [element, options.loop, read]);
  React.useEffect(() => {
    if (!frame) return; const document = frame.ownerDocument;
    const update = () => setState(previous => ({ ...previous, fullscreen: document.fullscreenElement === frame }));
    document.addEventListener('fullscreenchange', update); update(); return () => document.removeEventListener('fullscreenchange', update);
  }, [frame]);
  const play = async () => {
    if (!element) return false;
    const generation = ++serial.current; desiredPlay.current = true; setState(previous => ({ ...previous, pending: true, failed: false }));
    try { await element.play(); if (liveElement.current !== element || generation !== serial.current) { if (liveElement.current !== element || !desiredPlay.current) element.pause(); return false; } read(); return true; }
    catch { if (liveElement.current === element && generation === serial.current) { setState(previous => ({ ...previous, failed: true })); notify(callbacks.current.onError); } return false; }
    finally { if (liveElement.current === element && generation === serial.current) setState(previous => ({ ...previous, pending: false })); }
  };
  const pause = () => { ++serial.current; desiredPlay.current = false; element?.pause(); setState(previous => ({ ...previous, pending: false })); read(); };
  return { ...state, kind, ready, peaks, attach, attachFrame, play, pause,
    togglePlay: () => { if (element?.paused) void play(); else pause(); },
    seek: seconds => { if (!element || !Number.isFinite(element.duration) || element.duration <= 0 || !Number.isFinite(seconds)) return; try { element.currentTime = mediaClamp(seconds, 0, element.duration); read(); } catch { /* Not seekable yet. */ } },
    setVolume: value => { if (!element || !Number.isFinite(value)) return; element.volume = mediaClamp(value, 0, 1); if (element.volume > 0) { lastVolume.current = element.volume; element.muted = false; } read(); },
    toggleMute: () => { if (!element) return; if (element.muted || element.volume === 0) { element.muted = false; if (element.volume === 0) element.volume = lastVolume.current; } else element.muted = true; read(); },
    toggleLoop: () => { if (element) { element.loop = !element.loop; read(); } },
    toggleFullscreen: async () => { if (!frame) return false; try { if (frame.ownerDocument.fullscreenElement === frame) await frame.ownerDocument.exitFullscreen(); else if (frame.requestFullscreen) await frame.requestFullscreen(); else return false; return true; } catch { return false; } },
  };
}
