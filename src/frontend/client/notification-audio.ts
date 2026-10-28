/** Browser-only, opt-in media. No playback backlog and no credentials/remote providers. */
import type { NotificationSoundKind } from './notification-feedback';
export interface NotificationSoundOptions {
  chat?: boolean;
  notifications?: boolean;
  muted?: boolean;
  /** 0–1, default 0.5. */
  volume?: number;
}
export type NotificationSoundStatus = 'disabled' | 'loading' | 'locked' | 'ready' | 'blocked' | 'unsupported';
export function notificationSoundOptions(value: boolean | NotificationSoundOptions | undefined): Required<NotificationSoundOptions> {
  const options = typeof value === 'boolean' ? { chat: value, notifications: value } : value ?? {};
  return { chat: options.chat === true, notifications: options.notifications === true, muted: options.muted === true,
    volume: typeof options.volume === 'number' && Number.isFinite(options.volume) ? Math.max(0, Math.min(1, options.volume)) : 0.5 };
}
export interface NotificationAudio { play(kind: NotificationSoundKind): void; unlock(): void; dispose(): void }
export function createNotificationAudio(options: Required<NotificationSoundOptions>, status: (value: NotificationSoundStatus) => void): NotificationAudio {
  let retired = false, unlocked = false, unlocking = false, lastPlay = -Infinity, current: HTMLAudioElement | null = null;
  const media: Partial<Record<NotificationSoundKind, HTMLAudioElement>> = {};
  const enabled = !options.muted && options.volume > 0 && (options.chat || options.notifications);
  const stop = (audio: HTMLAudioElement) => { audio.pause(); try { audio.currentTime = 0; } catch { /* Not loaded yet. */ } };
  const unlock = () => {
    if (retired || !enabled || unlocked || unlocking) return;
    const audio = media.chat ?? media.notification; if (!audio) return;
    unlocking = true; audio.volume = 0;
    void audio.play().then(() => {
      stop(audio); unlocking = false;
      if (!retired) { audio.volume = options.volume; unlocked = true; status('ready'); }
    }).catch(() => { unlocking = false; if (!retired) status('blocked'); });
  };
  const gesture = (event: Event) => { if (event.isTrusted) unlock(); };
  if (!enabled) status('disabled');
  else if (typeof Audio === 'undefined') status('unsupported');
  else {
    status('loading');
    void import('./notification-sound-assets').then(sources => {
      if (retired) return;
      for (const kind of ['chat', 'notification'] as const) {
        if (kind === 'chat' ? !options.chat : !options.notifications) continue;
        const audio = new Audio(sources.notificationSoundSources[kind]); audio.preload = 'auto'; audio.volume = options.volume;
        media[kind] = audio;
      }
      status('locked');
    }).catch(() => { if (!retired) status('blocked'); });
    document.addEventListener('pointerdown', gesture, { passive: true }); document.addEventListener('keydown', gesture);
  }
  return {
    unlock,
    play(kind) {
      const audio = media[kind], now = performance.now();
      if (retired || !enabled || !unlocked || unlocking || !audio || now - lastPlay < 750) return;
      lastPlay = now; if (current) stop(current); current = audio;
      audio.volume = options.volume;
      void audio.play().catch(() => { if (!retired) { unlocked = false; status('blocked'); } });
    },
    dispose() {
      retired = true;
      document.removeEventListener('pointerdown', gesture); document.removeEventListener('keydown', gesture);
      for (const audio of Object.values(media)) { stop(audio); audio.removeAttribute('src'); audio.load(); }
      current = null;
    },
  };
}
