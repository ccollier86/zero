---
id: zero.frontend.components.blog.media
type: reference
audience: [developer, agent]
owner: frontend-components
status: in-review
visibility: internal
system: frontend-components
feature: blog-ui
maturity: preview
applies_to: ["2.6.0 UI feature snapshot; not the selected main archive"]
modes: [browser, SSR, public-pages]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "ac857766bc10c8a0643622bf95bb541159592c31"
  snapshot: dirty
  date: "2026-10-25"
  evidence_level: source-observed
---

# Composable Blog Audio And Video

[Blog UI index](./index.md) · [Documentation index](../../../../index.md)

Import players, their controls and hooks from `@zero/framework/blog`. Each
player owns exactly one native HTMLMediaElement and local controller. Defaults
work without assembling controls. Children replace that control composition;
they do not create another audio/video element.

```tsx
import { AudioPlayer, VideoPlayer, VideoPlayerContent,
  VideoPlayerControlBar, VideoPlayerPlayButton,
  VideoPlayerTimeRange, VideoPlayerFullscreenButton } from '@zero/framework/blog';

<AudioPlayer src="/media/interview.mp3" title="Interview" />;
<VideoPlayer src="/media/guide.webm" title="Guide">
  <VideoPlayerContent>
    <VideoPlayerControlBar>
      <VideoPlayerPlayButton />
      <VideoPlayerTimeRange />
      <VideoPlayerFullscreenButton />
    </VideoPlayerControlBar>
  </VideoPlayerContent>
</VideoPlayer>;
```

## Player Options

| Input | Default and contract |
| --- | --- |
| src | Required safe HTTP(S) or root-relative media URL. Native formats/codecs depend on the browser. No inferred YouTube/Vimeo iframe. |
| title / artist / coverArt / poster | Omitted. Safe cover/poster URLs only; absent data creates no dummy media. |
| autoPlay / preload | false / none. Autoplay remains subject to browser policy. metadata/auto are explicit choices. |
| muted / loop / defaultVolume | false / false / 1. Volume is bounded 0–1; defaultVolume initializes each native source. muted/loop prop changes synchronize native state. Control buttons also update that state. |
| variant | default; minimal and synthwave are semantic-token presentations. AudioPlayerMinimal/AudioPlayerSynthwave select them. |
| aspectRatio / rounded | video / xl. Aspect alternatives square, 4/3, 21/9; radii none, sm, md, lg, xl. |
| controlsLayout | Video overlay, audio below. Video also accepts below. |
| controlsAutoHideMs | 2500 for playing overlay video; 0 disables, other finite values bound to 500–30000. Controls stay present while paused or focused. Hidden controls are inert. |
| skipSeconds | 10. Individual seek buttons can override seconds. |
| showSkip / showVolume / showLoop / showWaveform / showFullscreen | true; relevant default controls only. Supplied children replace defaults entirely. |
| peaks | Optional measured normalized audio samples. Rendering is bounded to 256 bars; no randomized or invented waveform. |
| tracks | Optional native subtitles/captions/descriptions: src, srcLang, label, kind and default. The app supplies authorized files. |
| onPlay / onPause / onError | Optional observers. Raw playback exceptions/URLs are never displayed. |
| className / style / children | Scoped composition and visual overrides. |

Native controls are included in server HTML and remain the no-JavaScript
fallback. After hydration, shared buttons and native range inputs control the
same native element. Seeking requires finite loaded duration; it is disabled
before metadata rather than pretending playback progressed.

## Control Parts

| Audio parts | Video counterparts / role |
| --- | --- |
| AudioPlayerPlayButton | VideoPlayerPlayButton: play/pause and pending state. |
| AudioPlayerSkipBackwardButton / AudioPlayerSkipForwardButton | VideoPlayerSeekBackwardButton / VideoPlayerSeekForwardButton: seconds option. |
| AudioPlayerProgress | VideoPlayerTimeRange: native seek slider. |
| AudioPlayerTimeDisplay | VideoPlayerTimeDisplay: format elapsed, remaining or both. |
| AudioPlayerMuteButton | VideoPlayerMuteButton. |
| AudioPlayerVolumeSlider | VideoPlayerVolumeRange: native 0–1 slider. |
| AudioPlayerLoopButton | Available in either local media context. |
| AudioPlayerWaveform | Measured peaks/seek input for audio. |
| — | VideoPlayerFullscreenButton: requests fullscreen only on intent; unsupported/denied requests safely return false. |

Button parts accept normal Zero Button props and compose an onClick callback;
preventDefault vetoes the built-in action. VideoPlayerControlBar and
VideoPlayerContent are layout wrappers, not duplicate controllers.
VideoPlayerDefault is an alias of VideoPlayer.

`useAudioPlayer()` / `useVideoPlayer()` require the corresponding player.
They expose playing/muted/loop/time/duration/volume/buffered/pending/failed/
fullscreen, real seek/play/pause/volume/mute/loop/fullscreen operations and
normalized source kind. Do not mount a second native element with the internal
attachment functions. `play()` and `toggleFullscreen()` return a success boolean
asynchronously; unsupported/rejected operations do not report invented success.

## Lifecycle Accessibility And Performance

A source change replaces and pauses the retired native element. Pending play
operations are generation-checked; stale resolutions cannot mutate the new
source or leave a retired element playing. Unmount removes listeners and pauses
the owned element. Native events drive time/progress; no idle animation clock
or global playback store runs.

Focused video frames support Space/K for playback and left/right seek. Form
controls retain their own keyboard semantics. Ranges/buttons have labels and
native keyboard behavior. Reduced-motion removes decorative transitions, not
native media controls or captions.

Waveform/tint/glow, radii, aspect geometry, control spacing and overlay material
use `--zero-blog-*` roles. Synthwave is an optional token treatment, not another
theme/font loader. Explicit autoplay/preload choices can consume bandwidth;
the default does not request media preloading.

## Related Guides And Next Steps

- [Configuration](./configuration.md) owns semantic tokens and public branding.
- [Images and previews](./images-and-previews.md) owns image galleries/lens behavior.
- [Migration inventory](./migration.md) maps every recovered media export.
